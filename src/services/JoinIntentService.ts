import { prisma } from '../db/prisma.js';
import { walletService } from './WalletService.js';
import { matchmaker } from './Matchmaker.js';
import { matchService } from './MatchService.js';
import { matchIdToRoomId, roomIdToString } from '../utils/roomId.js';
import { ROOM_PRESETS } from '../constants/rooms.js';
import { Player } from '../types/game.js';
import crypto from 'crypto';

export interface JoinIntent {
  id: string;
  roomId: string | null; // Match ID (string)
  onChainRoomId: string | null; // On-chain room ID (uint64 as decimal string)
  playerId: string;
  walletId: string;
  roomType: 'ton';
  stake: number;
  nonce: string;
  status: 'CREATED' | 'PAID' | 'CANCELLED' | 'REFUNDED';
  expiresAt: Date;
  createdAt: Date;
  paidAt: Date | null;
}

export interface PaymentParams {
  to: string;      // Escrow address (smart contract)
  amount: string;  // Amount in nanotons (1 TON = 10^9 nanotons)
  comment: string; // Nonce for transaction matching
}

const INTENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Service for managing JoinIntent - on-chain deposit intents for TON rooms
 */
export class JoinIntentService {
  /**
   * Create join intent for TON room entry
   * Validates wallet connection, creates/finds match, and computes roomId
   */
  async createJoinIntent(
    playerId: string,
    playerName: string = 'Player',
    roomType: 'ton'
  ): Promise<{ intent: JoinIntent; paymentParams: PaymentParams }> {
    // Verify player has connected wallet
    const wallet = await walletService.getWalletByPlayerId(playerId);
    if (!wallet) {
      throw new Error('Wallet not connected. Please connect your TON wallet first');
    }

    // Get room preset
    const preset = ROOM_PRESETS.find((p) => p.type === roomType);
    if (!preset) {
      throw new Error(`Room preset not found for type: ${roomType}`);
    }

    // Check for existing active intent (not expired, not paid, not cancelled)
    const existingIntent = await prisma.joinIntent.findFirst({
      where: {
        playerId,
        roomType,
        status: 'CREATED',
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (existingIntent) {
      console.log(`⚠️ Player ${playerId} already has active intent ${existingIntent.id}`);
      // Return existing intent with payment params
      const intent = this.dbIntentToIntent(existingIntent);
      const paymentParams = this.getPaymentParams(intent);
      return {
        intent,
        paymentParams,
      };
    }

    // Create or find match through matchmaker
    const player: Player = {
      id: playerId,
      name: playerName,
      score: 0,
    };

    const match = await matchmaker.findOrCreateMatch(roomType, player);
    
    // Compute on-chain roomId from matchId
    const onChainRoomId = matchIdToRoomId(match.id);
    const onChainRoomIdStr = roomIdToString(onChainRoomId);
    
    // Save match to database (roomId will be computed and saved by matchService.saveMatch)
    await matchService.saveMatch(match);

    // Calculate stake (entryFee in TON)
    const stake = preset.entryFee;

    // Generate unique nonce for transaction matching
    const nonce = this.generateNonce();

    // Calculate expiration (5 minutes from now)
    const expiresAt = new Date(Date.now() + INTENT_TIMEOUT_MS);

    // Create intent with matchId and onChainRoomId
    const dbIntent = await prisma.joinIntent.create({
      data: {
        playerId,
        walletId: wallet.id,
        roomId: match.id, // Match ID (string)
        onChainRoomId: onChainRoomIdStr, // On-chain room ID (uint64 as decimal string)
        roomType,
        stake,
        nonce,
        status: 'CREATED',
        expiresAt,
      },
    });

    console.log(`✅ Created join intent ${dbIntent.id} for player ${playerId}, matchId: ${match.id}, roomId: ${onChainRoomIdStr}, nonce: ${nonce}`);

    const intent = this.dbIntentToIntent(dbIntent);
    const paymentParams = this.getPaymentParams(intent);

    return { intent, paymentParams };
  }

  /**
   * Get payment parameters for TON Connect sendTransaction
   * Format: join:{roomId}:{nonce}
   * Amount: entryFee + gasReserve (default 0.05 TON)
   */
  getPaymentParams(intent: JoinIntent): PaymentParams {
    // Get escrow address from environment variable
    // This will be the smart contract address
    const escrowAddress = process.env.TON_ESCROW_ADDRESS;
    if (!escrowAddress) {
      throw new Error('TON_ESCROW_ADDRESS not configured in environment');
    }

    if (!intent.onChainRoomId) {
      throw new Error('Intent missing onChainRoomId. Cannot create payment params.');
    }

    // Gas reserve for transaction (0.05 TON default)
    const GAS_RESERVE_TON = parseFloat(process.env.TON_GAS_RESERVE || '0.05');
    const totalAmount = intent.stake + GAS_RESERVE_TON;

    // Convert TON to nanotons (1 TON = 10^9 nanotons)
    const entryNano = Math.floor(intent.stake * 1_000_000_000);
    const gasReserveNano = Math.floor(GAS_RESERVE_TON * 1_000_000_000);
    const totalNano = (entryNano + gasReserveNano).toString();

    // Comment format: join:{roomId}:{nonce}
    // Example: join:115885390262228992:9912312
    const comment = `join:${intent.onChainRoomId}:${intent.nonce}`;

    return {
      to: escrowAddress,
      amount: totalNano, // entryFee + gasReserve
      comment,
    };
  }

  /**
   * Get intent by ID
   */
  async getIntent(intentId: string): Promise<JoinIntent | null> {
    const dbIntent = await prisma.joinIntent.findUnique({
      where: { id: intentId },
    });

    if (!dbIntent) {
      return null;
    }

    return this.dbIntentToIntent(dbIntent);
  }

  /**
   * Get intent by nonce (for blockchain transaction matching)
   */
  async getIntentByNonce(nonce: string): Promise<JoinIntent | null> {
    const dbIntent = await prisma.joinIntent.findUnique({
      where: { nonce },
    });

    if (!dbIntent) {
      return null;
    }

    return this.dbIntentToIntent(dbIntent);
  }

  /**
   * Get active intent for player (CREATED status, not expired)
   */
  async getActiveIntent(playerId: string, roomType: 'ton'): Promise<JoinIntent | null> {
    const dbIntent = await prisma.joinIntent.findFirst({
      where: {
        playerId,
        roomType,
        status: 'CREATED',
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!dbIntent) {
      return null;
    }

    return this.dbIntentToIntent(dbIntent);
  }

  /**
   * Mark intent as PAID when deposit transaction is confirmed
   */
  async markIntentPaid(intentId: string, txHash: string): Promise<JoinIntent> {
    const dbIntent = await prisma.joinIntent.findUnique({
      where: { id: intentId },
    });

    if (!dbIntent) {
      throw new Error(`Intent ${intentId} not found`);
    }

    if (dbIntent.status !== 'CREATED') {
      throw new Error(`Intent ${intentId} is not in CREATED status (current: ${dbIntent.status})`);
    }

    // Update intent status
    const updated = await prisma.joinIntent.update({
      where: { id: intentId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
      },
    });

    console.log(`✅ Marked intent ${intentId} as PAID (tx: ${txHash})`);

    return this.dbIntentToIntent(updated);
  }

  /**
   * Cancel intent (e.g., if user abandons or timeout)
   */
  async cancelIntent(intentId: string, reason?: string): Promise<JoinIntent> {
    const dbIntent = await prisma.joinIntent.findUnique({
      where: { id: intentId },
    });

    if (!dbIntent) {
      throw new Error(`Intent ${intentId} not found`);
    }

    if (dbIntent.status !== 'CREATED') {
      throw new Error(`Cannot cancel intent ${intentId} - status is ${dbIntent.status}`);
    }

    const updated = await prisma.joinIntent.update({
      where: { id: intentId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    console.log(`✅ Cancelled intent ${intentId}${reason ? ` (reason: ${reason})` : ''}`);

    return this.dbIntentToIntent(updated);
  }

  /**
   * Cancel expired intents (should be called periodically)
   */
  async cancelExpiredIntents(): Promise<number> {
    const now = new Date();
    
    const result = await prisma.joinIntent.updateMany({
      where: {
        status: 'CREATED',
        expiresAt: {
          lt: now,
        },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
      },
    });

    if (result.count > 0) {
      console.log(`✅ Cancelled ${result.count} expired intents`);
    }

    return result.count;
  }

  /**
   * Get paid intent for player that can be used to join a room
   * Now intent is created with roomId immediately, so we find by matchId
   */
  async getPaidIntentForJoin(playerId: string, matchId: string, roomType: 'ton'): Promise<JoinIntent | null> {
    const dbIntent = await prisma.joinIntent.findFirst({
      where: {
        playerId,
        roomType,
        status: 'PAID',
        roomId: matchId, // Intent is created with roomId (matchId) immediately
      },
      orderBy: {
        paidAt: 'desc',
      },
    });

    if (!dbIntent) {
      return null;
    }

    return this.dbIntentToIntent(dbIntent);
  }

  /**
   * Link intent to match after player joins
   */
  async linkIntentToMatch(intentId: string, matchId: string): Promise<void> {
    await prisma.joinIntent.update({
      where: { id: intentId },
      data: { roomId: matchId },
    });

    console.log(`✅ Linked intent ${intentId} to match ${matchId}`);
  }

  /**
   * Get intent linked to a specific match for a player
   */
  async getIntentForMatch(playerId: string, matchId: string): Promise<JoinIntent | null> {
    const dbIntent = await prisma.joinIntent.findFirst({
      where: {
        playerId,
        roomId: matchId,
        status: 'PAID', // Only refund PAID intents
      },
      orderBy: {
        paidAt: 'desc',
      },
    });

    if (!dbIntent) {
      return null;
    }

    return this.dbIntentToIntent(dbIntent);
  }

  /**
   * Create refund for a player leaving a match before it starts
   * Returns refund ID if created, null if refund already exists or intent not found
   */
  async createRefundForPlayer(playerId: string, matchId: string, reason: 'player_left' | 'match_cancelled' = 'player_left'): Promise<string | null> {
    // Find PAID intent for this player and match
    const intent = await this.getIntentForMatch(playerId, matchId);
    
    if (!intent) {
      console.log(`⚠️ No PAID intent found for player ${playerId} in match ${matchId} - no refund needed`);
      return null;
    }

    // Check if refund already exists
    const existingRefund = await prisma.refund.findUnique({
      where: { joinIntentId: intent.id },
    });

    if (existingRefund) {
      console.log(`⚠️ Refund already exists for intent ${intent.id}`);
      return existingRefund.id;
    }

    // Get wallet address for refund
    const wallet = await walletService.getWalletByPlayerId(playerId);
    if (!wallet) {
      throw new Error(`Wallet not found for player ${playerId}`);
    }

    // Create refund record
    const refund = await prisma.refund.create({
      data: {
        joinIntentId: intent.id,
        amount: intent.stake,
        toAddress: wallet.address,
        status: 'CREATED',
        reason,
      },
    });

    // Update intent status to REFUNDED
    await prisma.joinIntent.update({
      where: { id: intent.id },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
      },
    });

    console.log(`✅ Created refund ${refund.id} for intent ${intent.id} (reason: ${reason})`);

    return refund.id;
  }

  /**
   * Generate unique nonce for transaction matching
   */
  private generateNonce(): string {
    // Generate 32 random bytes, encode as hex (64 characters)
    // This ensures uniqueness and makes it easy to match in transaction comment
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Convert Prisma JoinIntent to JoinIntent interface
   */
  private dbIntentToIntent(dbIntent: any): JoinIntent {
    return {
      id: dbIntent.id,
      roomId: dbIntent.roomId,
      onChainRoomId: dbIntent.onChainRoomId,
      playerId: dbIntent.playerId,
      walletId: dbIntent.walletId,
      roomType: dbIntent.roomType as 'ton',
      stake: Number(dbIntent.stake),
      nonce: dbIntent.nonce,
      status: dbIntent.status as 'CREATED' | 'PAID' | 'CANCELLED' | 'REFUNDED',
      expiresAt: dbIntent.expiresAt,
      createdAt: dbIntent.createdAt,
      paidAt: dbIntent.paidAt,
    };
  }
}

// Singleton instance
export const joinIntentService = new JoinIntentService();

