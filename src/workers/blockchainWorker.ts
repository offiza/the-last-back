import { Server } from 'socket.io';
import { tonBlockchainService } from '../services/TonBlockchainService.js';
import { joinIntentService } from '../services/JoinIntentService.js';
import { escrowService } from '../services/EscrowService.js';
import { prisma } from '../db/prisma.js';

const CHECK_INTERVAL_MS = 30000; // Check every 30 seconds

/**
 * Blockchain worker for monitoring escrow transactions
 * Periodically checks for new deposits and updates intent statuses
 */
export class BlockchainWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private io: Server | null = null;
  private lastCheckedLt: string | null = null;

  /**
   * Start the blockchain worker
   */
  start(io: Server) {
    this.io = io;

    if (this.intervalId) {
      console.log('⚠️ Blockchain worker already running');
      return;
    }

    console.log('🔍 Starting blockchain worker...');

    // Run immediately on start
    this.checkTransactions().catch((error) => {
      console.error('❌ Error in initial blockchain check:', error);
    });

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.checkTransactions().catch((error) => {
        console.error('❌ Error in blockchain check:', error);
      });
    }, CHECK_INTERVAL_MS);

    // Also cancel expired intents periodically (every minute)
    setInterval(() => {
      this.cancelExpiredIntents().catch((error) => {
        console.error('❌ Error cancelling expired intents:', error);
      });
    }, 60000);
  }

  /**
   * Stop the blockchain worker
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 Blockchain worker stopped');
    }
  }

  /**
   * Check for new deposits and process them
   */
  private async checkTransactions() {
    try {
      const escrowAddress = escrowService.getEscrowAddress();
      
      // Get active CREATED intents to check
      const activeIntents = await prisma.joinIntent.findMany({
        where: {
          status: 'CREATED',
          expiresAt: {
            gt: new Date(),
          },
        },
        select: {
          id: true,
          nonce: true,
          stake: true,
        },
      });

      if (activeIntents.length === 0) {
        return; // No active intents to check
      }

      // Check incoming transactions
      const matches = await tonBlockchainService.checkIncomingTransactions(
        escrowAddress,
        this.lastCheckedLt || undefined
      );

      if (matches.length === 0) {
        return; // No new matching transactions
      }

      console.log(`📥 Found ${matches.length} matching deposit transaction(s)`);

      // Process each match
      for (const match of matches) {
        await this.processDepositMatch(match);
      }
    } catch (error) {
      console.error('Error checking transactions:', error);
      // Don't throw - worker should continue running
    }
  }

  /**
   * Process a matched deposit transaction
   */
  private async processDepositMatch(match: {
    intentId: string;
    nonce: string;
    txHash: string;
    fromAddress: string;
    amount: string;
  }) {
    try {
      // Get intent
      const intent = await joinIntentService.getIntent(match.intentId);
      if (!intent || intent.status !== 'CREATED') {
        console.log(`⚠️ Intent ${match.intentId} not found or not in CREATED status`);
        return;
      }

      // Verify transaction exists
      const tx = await tonBlockchainService.getTransaction(match.txHash);
      if (!tx) {
        console.warn(`⚠️ Transaction ${match.txHash} not found`);
        return;
      }

      // Verify amount matches (convert nanotons to TON for comparison)
      const receivedAmountTon = escrowService.nanotonsToTon(match.amount);
      const expectedAmount = intent.stake;

      if (!escrowService.validateDepositAmount(receivedAmountTon, expectedAmount)) {
        console.warn(
          `⚠️ Amount mismatch for intent ${match.intentId}: expected ${expectedAmount}, got ${receivedAmountTon}`
        );
        return;
      }

      // Verify timestamp is reasonable
      if (!escrowService.validateDepositTimestamp(tx.blockTime)) {
        console.warn(`⚠️ Transaction ${match.txHash} timestamp is invalid`);
        return;
      }

      // Check if DepositTx already exists (idempotency)
      const existingDeposit = await prisma.depositTx.findUnique({
        where: { txHash: match.txHash },
      });

      if (existingDeposit) {
        console.log(`ℹ️ Deposit transaction ${match.txHash} already processed`);
        
        // If intent is still CREATED, mark as PAID
        if (intent.status === 'CREATED') {
          await joinIntentService.markIntentPaid(match.intentId, match.txHash);
        }
        
        return;
      }

      // Create DepositTx record
      const depositTx = await prisma.depositTx.create({
        data: {
          joinIntentId: match.intentId,
          txHash: match.txHash,
          fromAddress: match.fromAddress,
          toAddress: escrowService.getEscrowAddress(),
          amount: receivedAmountTon,
          status: 'CONFIRMED',
          confirmedAt: new Date(tx.blockTime * 1000), // Convert seconds to milliseconds
          blockNumber: tx.blockNumber ? BigInt(tx.blockNumber) : null,
        },
      });

      // Mark intent as PAID
      await joinIntentService.markIntentPaid(match.intentId, match.txHash);

      console.log(`✅ Processed deposit for intent ${match.intentId}, tx: ${match.txHash}`);

      // Notify via WebSocket if available
      if (this.io) {
        // Get playerId from intent to send notification
        const intentWithPlayer = await prisma.joinIntent.findUnique({
          where: { id: match.intentId },
          select: { playerId: true },
        });

        if (intentWithPlayer) {
          // Emit to player's socket room (player:playerId)
          // And also to intent-specific room (intent:intentId)
          const playerRoom = `player:${intentWithPlayer.playerId}`;
          const intentRoom = `intent:${match.intentId}`;
          
          const eventData = {
            intentId: match.intentId,
            status: 'PAID',
            txHash: match.txHash,
          };
          
          // Send to both rooms for flexibility
          this.io.to(playerRoom).emit('join-intent:paid', eventData);
          this.io.to(intentRoom).emit('join-intent:paid', eventData);
          
          console.log(`📡 Sent join-intent:paid event for intent ${match.intentId} to rooms: ${playerRoom}, ${intentRoom}`);
        }
      }
    } catch (error) {
      console.error(`Error processing deposit match for intent ${match.intentId}:`, error);
    }
  }

  /**
   * Cancel expired intents
   */
  private async cancelExpiredIntents() {
    const cancelled = await joinIntentService.cancelExpiredIntents();
    // No need to notify via WebSocket for expired intents - they'll be checked on status request
  }
}

// Singleton instance
export const blockchainWorker = new BlockchainWorker();

