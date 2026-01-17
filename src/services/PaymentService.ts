import { Match, Player } from '../types/game';
import { determineWinners, calculatePayout } from '../utils/gameLogic.js';
import { ROOM_PRESETS } from '../constants/rooms.js';
import { prisma } from '../db/prisma.js';
import crypto from 'crypto';

export interface PaymentRecord {
  id: string;
  matchId: string;
  playerId: string;
  playerName: string;
  amount: number;
  currency: 'stars' | 'ton';
  status: 'pending' | 'completed' | 'failed';
  timestamp: Date;
  signature: string; // Cryptographic signature for verification
  verified: boolean;
}

export interface MatchPaymentData {
  matchId: string;
  winners: Array<{
    playerId: string;
    playerName: string;
    amount: number;
    verified: boolean;
  }>;
  totalBank: number;
  payout: number;
  timestamp: Date;
  signature: string;
}

export class PaymentService {
  private secretKey: string;

  constructor() {
    // Use environment variable for secret key, fallback to generated one (not secure for production!)
    this.secretKey = process.env.PAYMENT_SECRET_KEY || crypto.randomBytes(32).toString('hex');
    if (!process.env.PAYMENT_SECRET_KEY) {
      console.warn('⚠️ PAYMENT_SECRET_KEY not set, using random key (not secure for production!)');
    }
  }

  /**
   * Generate cryptographic signature for payment data
   */
  private generateSignature(data: string): string {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(data)
      .digest('hex');
  }

  /**
   * Verify payment signature
   */
  verifySignature(data: string, signature: string): boolean {
    const expectedSignature = this.generateSignature(data);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Create payment record for a winner
   * This should be called ONLY on the backend when match finishes
   * @deprecated Use processMatchCompletion instead, which creates all winner payments at once
   */
  async createPaymentRecord(
    match: Match,
    playerId: string,
    amount: number
  ): Promise<PaymentRecord> {
    // Verify player is actually a winner
    const playersToCheck = match.allPlayers && match.allPlayers.length > 0 
      ? match.allPlayers 
      : match.players;
    
    const winners = determineWinners(playersToCheck);
    const isWinner = winners.some((w) => w.id === playerId);
    
    if (!isWinner) {
      throw new Error(`Player ${playerId} is not a winner in match ${match.id}`);
    }

    // Verify player participated in match
    const player = playersToCheck.find((p) => p.id === playerId);
    if (!player) {
      throw new Error(`Player ${playerId} not found in match ${match.id}`);
    }

    // Check if payment already exists
    const existingPayment = await prisma.payment.findFirst({
      where: {
        matchId: match.id,
        playerId,
        paymentType: 'payout',
      },
    });

    if (existingPayment) {
      throw new Error(`Payment already exists for player ${playerId} in match ${match.id}`);
    }

    // Create payment data string for signing
    const paymentId = crypto.randomUUID();
    const paymentData = `${match.id}:${playerId}:${amount}:${match.roomType}:${Date.now()}`;
    const signature = this.generateSignature(paymentData);

    const dbPayment = await prisma.payment.create({
      data: {
        id: paymentId,
        matchId: match.id,
        playerId,
        playerName: player.name,
        amount,
        currency: match.roomType === 'stars' ? 'stars' : 'ton',
        paymentType: 'payout',
        status: 'pending',
        signature,
        verified: true,
      },
    });

    console.log(`✅ Created payment record ${paymentId} for player ${playerId} in match ${match.id}`);

    return this.dbPaymentToRecord(dbPayment);
  }

  /**
   * Process match completion and create payment records for all winners
   * This is the ONLY safe way to determine winners and create payments
   */
  async processMatchCompletion(match: Match): Promise<MatchPaymentData> {
    // Verify match is finished
    if (match.status !== 'finished') {
      throw new Error(`Match ${match.id} is not finished`);
    }

    // Check if already processed
    const existingPayments = await prisma.payment.findMany({
      where: {
        matchId: match.id,
        paymentType: 'payout',
      },
    });

    if (existingPayments.length > 0) {
      const existing = await this.getMatchPayment(match.id);
      if (existing) {
        console.warn(`⚠️ Match ${match.id} already processed, returning existing payment data`);
        return existing;
      }
    }

    // Use allPlayers to include players who left
    const playersToCheck = match.allPlayers && match.allPlayers.length > 0 
      ? match.allPlayers 
      : match.players;

    // Determine winners (server-side only, cannot be manipulated)
    const winners = determineWinners(playersToCheck);
    
    if (winners.length === 0) {
      throw new Error(`No winners found in match ${match.id}`);
    }

    // Calculate payout
    const preset = ROOM_PRESETS.find(
      (p) => p.type === match.roomType
    );
    if (!preset) {
      throw new Error(`Room preset not found for type: ${match.roomType}`);
    }

    const totalBank = preset.entryFee * playersToCheck.length;
    const payout = calculatePayout(totalBank, preset.platformFee, winners.length);

    // Create payment records for all winners in database
    const winnerPayments = await Promise.all(
      winners.map(async (winner) => {
        const paymentId = crypto.randomUUID();
        const paymentData = `${match.id}:${winner.id}:${payout}:${match.roomType}:${Date.now()}`;
        const signature = this.generateSignature(paymentData);

        await prisma.payment.create({
          data: {
            id: paymentId,
            matchId: match.id,
            playerId: winner.id,
            playerName: winner.name,
            amount: payout,
            currency: match.roomType === 'stars' ? 'stars' : 'ton',
            paymentType: 'payout',
            status: 'pending',
            signature,
            verified: true,
          },
        });

        return {
          playerId: winner.id,
          playerName: winner.name,
          amount: payout,
          verified: true,
        };
      })
    );

    // Create match payment data with signature
    const matchData = JSON.stringify({
      matchId: match.id,
      winners: winnerPayments,
      totalBank,
      payout,
      timestamp: Date.now(),
    });
    const signature = this.generateSignature(matchData);

    const matchPaymentData: MatchPaymentData = {
      matchId: match.id,
      winners: winnerPayments,
      totalBank,
      payout,
      timestamp: new Date(),
      signature,
    };

    console.log(`✅ Processed match ${match.id} completion, ${winners.length} winners`);

    return matchPaymentData;
  }

  /**
   * Verify payment request from client
   * Client must provide matchId, playerId, and signature
   */
  async verifyPaymentRequest(
    matchId: string,
    playerId: string,
    clientSignature: string
  ): Promise<PaymentRecord | null> {
    try {
      const payment = await prisma.payment.findFirst({
        where: {
          matchId,
          playerId,
        },
      });

      if (!payment) {
        console.warn(`⚠️ Payment not found for match ${matchId}, player ${playerId}`);
        return null;
      }

      // Verify signature
      const paymentData = `${matchId}:${playerId}:${payment.amount.toString()}:${payment.currency}:${payment.createdAt.getTime()}`;
      if (!this.verifySignature(paymentData, clientSignature)) {
        console.error(`❌ Invalid signature for payment ${payment.id}`);
        return null;
      }

      return this.dbPaymentToRecord(payment);
    } catch (error) {
      console.error('Error verifying payment request:', error);
      return null;
    }
  }

  /**
   * Mark payment as completed (after actual payment processing)
   */
  async markPaymentCompleted(paymentId: string): Promise<void> {
    try {
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });
      console.log(`✅ Payment ${paymentId} marked as completed`);
    } catch (error) {
      console.error('Error marking payment as completed:', error);
      throw error;
    }
  }

  /**
   * Get payment record
   */
  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        return null;
      }

      return this.dbPaymentToRecord(payment);
    } catch (error) {
      console.error('Error getting payment:', error);
      return null;
    }
  }

  /**
   * Get match payment data
   */
  async getMatchPayment(matchId: string): Promise<MatchPaymentData | null> {
    try {
      // Get all payout payments for this match
      const payoutPayments = await prisma.payment.findMany({
        where: {
          matchId,
          paymentType: 'payout',
        },
      });

      if (payoutPayments.length === 0) {
        return null;
      }

      // Get match to calculate total bank
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          players: true,
        },
      });

      if (!match) {
        return null;
      }

      const preset = ROOM_PRESETS.find((p) => p.type === match.roomType);
      if (!preset) {
        return null;
      }

      const totalBank = Number(preset.entryFee) * match.players.length;
      const payout = payoutPayments[0] ? Number(payoutPayments[0].amount) : 0;

      const winners = payoutPayments.map((p: any) => ({
        playerId: p.playerId,
        playerName: p.playerName,
        amount: Number(p.amount),
        verified: p.verified,
      }));

      const matchData = JSON.stringify({
        matchId,
        winners,
        totalBank,
        payout,
        timestamp: match.finishedAt?.getTime() || Date.now(),
      });
      const signature = this.generateSignature(matchData);

      return {
        matchId,
        winners,
        totalBank,
        payout,
        timestamp: match.finishedAt || new Date(),
        signature,
      };
    } catch (error) {
      console.error('Error getting match payment:', error);
      return null;
    }
  }

  /**
   * Get all payments for a player
   */
  async getPlayerPayments(playerId: string): Promise<PaymentRecord[]> {
    try {
      const payments = await prisma.payment.findMany({
        where: { playerId },
        orderBy: { createdAt: 'desc' },
      });

      return payments.map((p: any) => this.dbPaymentToRecord(p));
    } catch (error) {
      console.error('Error getting player payments:', error);
      return [];
    }
  }

  /**
   * Create entry payment record (before joining paid room)
   * This creates a pending payment that must be verified before match join
   */
  async createEntryPayment(
    playerId: string,
    playerName: string,
    roomType: 'stars' | 'ton',
    entryFee: number
  ): Promise<{ paymentId: string; signature: string }> {
    // Generate unique payment ID
    const paymentId = crypto.randomUUID();
    
    // Create payment data string for signing
    const paymentData = `${paymentId}:${playerId}:${entryFee}:${roomType}:${Date.now()}`;
    const signature = this.generateSignature(paymentData);

    try {
      // Create payment record in database
      await prisma.payment.create({
        data: {
          id: paymentId,
          playerId,
          playerName,
          amount: entryFee,
          currency: roomType,
          paymentType: 'entry',
          status: 'pending',
          signature,
          verified: false,
        },
      });

      console.log(`✅ Created entry payment ${paymentId} for player ${playerId}, room: ${roomType}`);
      return { paymentId, signature };
    } catch (error) {
      console.error('Error creating entry payment:', error);
      throw error;
    }
  }

  /**
   * Verify entry payment before joining room
   */
  async verifyEntryPayment(
    paymentId: string,
    playerId: string,
    signature: string
  ): Promise<boolean> {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        console.warn(`⚠️ Entry payment ${paymentId} not found`);
        return false;
      }

      if (payment.playerId !== playerId) {
        console.error(`❌ Entry payment playerId mismatch`);
        return false;
      }

      // Verify signature
      const paymentData = `${paymentId}:${playerId}:${payment.amount.toString()}:${payment.currency}:${payment.createdAt.getTime()}`;
      if (!this.verifySignature(paymentData, signature)) {
        console.error(`❌ Invalid signature for entry payment ${paymentId}`);
        return false;
      }

      // Mark as verified
      await prisma.payment.update({
        where: { id: paymentId },
        data: { verified: true },
      });

      console.log(`✅ Verified entry payment ${paymentId} for player ${playerId}`);
      return true;
    } catch (error) {
      console.error('Error verifying entry payment:', error);
      return false;
    }
  }

  /**
   * Link entry payment to match after successful join
   */
  async linkPaymentToMatch(paymentId: string, matchId: string): Promise<void> {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        throw new Error(`Payment ${paymentId} not found`);
      }

      if (!payment.verified) {
        throw new Error(`Payment ${paymentId} is not verified`);
      }

      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          matchId,
          status: 'completed', // Entry payment is completed when player joins
        },
      });

      console.log(`✅ Linked payment ${paymentId} to match ${matchId}`);
    } catch (error) {
      console.error('Error linking payment to match:', error);
      throw error;
    }
  }

  /**
   * Get entry payment by ID
   */
  async getEntryPayment(paymentId: string): Promise<PaymentRecord | null> {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment || payment.paymentType !== 'entry') {
        return null;
      }

      return this.dbPaymentToRecord(payment);
    } catch (error) {
      console.error('Error getting entry payment:', error);
      return null;
    }
  }

  /**
   * Get winner payment for a specific player in a match
   */
  async getWinnerPayment(matchId: string, playerId: string): Promise<PaymentRecord | null> {
    try {
      // First, try to find payout payment record
      const payoutPayment = await prisma.payment.findFirst({
        where: {
          matchId,
          playerId,
          paymentType: 'payout',
        },
      });

      if (payoutPayment) {
        return this.dbPaymentToRecord(payoutPayment);
      }

      // If no payout record, check if player is a winner by looking at match
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          players: {
            where: { playerId, isWinner: true },
          },
        },
      });

      if (match && match.players.length > 0) {
        // Player is a winner, but payout not created yet
        // Get currency from entry payment
        const entryPayment = await prisma.payment.findFirst({
          where: {
            matchId,
            paymentType: 'entry',
          },
        });

        const currency = (entryPayment?.currency as 'stars' | 'ton') || 'stars';
        const player = match.players[0];

        // Calculate payout amount (would need to get from match payment data or calculate)
        // For now, return a placeholder
        return {
          id: `${matchId}-${playerId}`,
          matchId,
          playerId,
          playerName: player.playerName,
          amount: 0, // Will be calculated from match
          currency,
          status: 'pending',
          timestamp: match.finishedAt || new Date(),
          signature: '',
          verified: false,
        };
      }

      return null;
    } catch (error) {
      console.error('Error getting winner payment:', error);
      return null;
    }
  }

  /**
   * Convert Prisma Payment to PaymentRecord
   */
  private dbPaymentToRecord(payment: any): PaymentRecord {
    return {
      id: payment.id,
      matchId: payment.matchId || '',
      playerId: payment.playerId,
      playerName: payment.playerName,
      amount: Number(payment.amount),
      currency: payment.currency as 'stars' | 'ton',
      status: payment.status as 'pending' | 'completed' | 'failed',
      timestamp: payment.createdAt,
      signature: payment.signature || '',
      verified: payment.verified,
    };
  }

  /**
   * Check if player is a winner in a match
   */
  async isPlayerWinner(matchId: string, playerId: string): Promise<boolean> {
    try {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          players: {
            where: {
              playerId,
              isWinner: true,
            },
          },
        },
      });

      return match ? match.players.length > 0 : false;
    } catch (error) {
      console.error('Error checking if player is winner:', error);
      return false;
    }
  }

  /**
   * Mark winner payment as sent (after actual payment processing)
   */
  async markWinnerPaymentSent(matchId: string, playerId: string): Promise<void> {
    try {
      const payment = await this.getWinnerPayment(matchId, playerId);
      if (payment && payment.id !== `${matchId}-${playerId}`) {
        // Only mark if it's an actual payment record (not a reference)
        await this.markPaymentCompleted(payment.id);
      } else {
        // Update existing payout payment
        await prisma.payment.updateMany({
          where: {
            matchId,
            playerId,
            paymentType: 'payout',
          },
          data: {
            status: 'completed',
            completedAt: new Date(),
          },
        });
      }
    } catch (error) {
      console.error('Error marking winner payment as sent:', error);
      throw error;
    }
  }
}

// Singleton instance
export const paymentService = new PaymentService();

