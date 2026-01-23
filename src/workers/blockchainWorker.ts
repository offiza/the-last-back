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

  /**
   * Start the blockchain worker
   */
  async start(io: Server) {
    this.io = io;

    if (this.intervalId) {
      console.log('⚠️ Blockchain worker already running');
      return;
    }

    console.log('🔍 Starting blockchain worker...');

    // Load lastCheckedLt from database
    await this.loadLastCheckedLt();

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

      // Load lastCheckedLt from database (persistent storage)
      const lastCheckedLt = await this.getLastCheckedLt();

      // Check incoming transactions
      const { matches, latestLt } = await tonBlockchainService.checkIncomingTransactions(
        escrowAddress,
        lastCheckedLt || undefined
      );

      if (matches.length === 0) {
        // Even if no matches, update lastCheckedLt to avoid reprocessing
        if (latestLt) {
          await this.saveLastCheckedLt(latestLt);
        }
        return; // No new matching transactions
      }

      console.log(`📥 Found ${matches.length} matching deposit transaction(s)`);

      // Process each match
      for (const match of matches) {
        await this.processDepositMatch(match);
      }

      // Update lastCheckedLt in database after processing all transactions
      // This ensures we don't reprocess the same transactions on next run
      if (latestLt) {
        await this.saveLastCheckedLt(latestLt);
        console.log(`💾 Updated lastCheckedLt to ${latestLt}`);
      }
    } catch (error) {
      console.error('Error checking transactions:', error);
      // Don't throw - worker should continue running
    }
  }

  /**
   * Load lastCheckedLt from database
   */
  private async loadLastCheckedLt(): Promise<void> {
    try {
      const state = await prisma.workerState.findUnique({
        where: { workerType: 'blockchain-worker' },
      });
      
      if (state?.lastCheckedLt) {
        console.log(`📊 Loaded lastCheckedLt from database: ${state.lastCheckedLt}`);
      }
    } catch (error) {
      console.error('Error loading lastCheckedLt:', error);
      // Continue without lastCheckedLt - will process all transactions on first run
    }
  }

  /**
   * Get lastCheckedLt from database
   */
  private async getLastCheckedLt(): Promise<string | null> {
    try {
      const state = await prisma.workerState.findUnique({
        where: { workerType: 'blockchain-worker' },
      });
      return state?.lastCheckedLt || null;
    } catch (error) {
      console.error('Error getting lastCheckedLt:', error);
      return null;
    }
  }

  /**
   * Save lastCheckedLt to database (persistent storage)
   */
  private async saveLastCheckedLt(lt: string): Promise<void> {
    try {
      await prisma.workerState.upsert({
        where: { workerType: 'blockchain-worker' },
        update: { lastCheckedLt: lt },
        create: {
          id: 'blockchain-worker',
          workerType: 'blockchain-worker',
          lastCheckedLt: lt,
        },
      });
    } catch (error) {
      console.error('Error saving lastCheckedLt:', error);
      // Don't throw - worker should continue even if save fails
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

      // CRITICAL: Verify transaction destination is escrow address (double-check)
      const escrowAddress = escrowService.getEscrowAddress();
      const txDestination = tx.inMsg?.destination?.address || tx.account?.address;
      if (!txDestination || txDestination !== escrowAddress) {
        console.warn(
          `⚠️ Transaction ${match.txHash} destination mismatch: expected ${escrowAddress}, got ${txDestination || 'unknown'}`
        );
        return;
      }

      // Convert nanotons to TON for comparison
      const receivedAmountTon = escrowService.nanotonsToTon(match.amount);
      
      // CRITICAL: Verify amount >= entryFee (entryFee only, ignore gasReserve in check)
      // Gas reserve may vary, but deposit must be at least entryFee
      const entryFee = intent.stake; // entryFee without gasReserve
      const TOLERANCE = 0.001; // Small rounding tolerance (0.001 TON)
      
      if (receivedAmountTon < entryFee - TOLERANCE) {
        console.warn(
          `⚠️ Amount too low for intent ${match.intentId}: received ${receivedAmountTon}, minimum entryFee ${entryFee}`
        );
        return;
      }

      // Additional check: amount should be close to expected (entryFee + gasReserve)
      // But don't fail if it's higher - player may have sent more
      const expectedWithGas = entryFee + parseFloat(process.env.TON_GAS_RESERVE || '0.05');
      if (receivedAmountTon > expectedWithGas * 1.5) {
        // Warn if amount is significantly higher (possible error)
        console.warn(
          `⚠️ Amount unusually high for intent ${match.intentId}: received ${receivedAmountTon}, expected ~${expectedWithGas}`
        );
        // Don't reject - player may have intentionally sent more
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

