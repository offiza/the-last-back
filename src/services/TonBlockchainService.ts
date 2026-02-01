import { Cell } from '@ton/core';
import { joinIntentService } from './JoinIntentService.js';
import { prisma } from '../db/prisma.js';

export interface TonTransaction {
  hash: string;
  lt: string;
  account?: {
    address?: string; // Account address (escrow for incoming transactions)
  };
  from?: {
    address: string;
  };
  outMessages?: Array<{
    destination?: {
      address: string;
    };
    value?: string | number; // Amount in nanotons
  }>;
  inMsg?: {
    value?: string | number; // Amount in nanotons (CRITICAL: use only this for deposits)
    destination?: {
      address: string; // Destination address (should be escrow address)
    };
    message?: {
      msg_data?: {
        text?: string;
      };
    };
    source?: {
      address: string;
    };
  };
  blockTime: number;
  blockNumber?: string;
}

export interface TransactionMatch {
  intentId: string;
  nonce: string;
  txHash: string;
  fromAddress: string;
  amount: string; // in nanotons
  blockTime: number; // Unix timestamp (seconds)
}

/** TonCenter v2 transaction format */
interface TonCenterTransaction {
  transaction_id: { lt: string; hash: string };
  in_msg?: {
    source?: string;
    destination?: string;
    value?: string;
    message?: string; // base64
  };
  utime?: number;
}

/**
 * Service for interacting with TON blockchain
 * Uses TonCenter API (free, stable). TonAPI optional via TON_API_URL.
 */
export class TonBlockchainService {
  private tonApiUrl: string;
  private tonApiKey: string | null;
  private tonCenterUrl: string;

  constructor() {
    const network = process.env.TON_NETWORK || 'testnet';
    // TonCenter: free, no key needed. Mainnet vs testnet.
    this.tonCenterUrl =
      network === 'mainnet'
        ? process.env.TON_MAINNET_ENDPOINT || 'https://toncenter.com/api/v2'
        : process.env.TON_TESTNET_ENDPOINT || 'https://testnet.toncenter.com/api/v2';

    // TonAPI (optional, can return 404 without key or if API changed)
    this.tonApiUrl = process.env.TON_API_URL || (network === 'mainnet' ? 'https://tonapi.io' : 'https://testnet.tonapi.io');
    this.tonApiKey = process.env.TON_API_KEY || null;
  }

  /**
   * Get API headers with authentication if available
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.tonApiKey) {
      headers['Authorization'] = `Bearer ${this.tonApiKey}`;
    }
    return headers;
  }

  /**
   * Decode text comment from TON message body (op 0x00000000 + UTF-8)
   * Handles both raw base64 and BOC-encoded cell
   */
  private decodeCommentFromBase64(base64: string): string | null {
    try {
      const buf = Buffer.from(base64, 'base64');
      if (buf.length < 4) return null;

      // Try BOC (Cell serialization)
      try {
        const cells = Cell.fromBoc(buf);
        if (cells.length > 0) {
          const slice = cells[0].beginParse();
          if (slice.loadUint(32) === 0) {
            return slice.loadStringTail().trim();
          }
        }
      } catch {
        // Not BOC, try raw
      }

      // Raw: op 4 bytes + UTF-8
      if (buf.readUInt32BE(0) !== 0) return null;
      return buf.slice(4).toString('utf-8').trim();
    } catch {
      return null;
    }
  }

  /**
   * Check incoming transactions to escrow address
   * Returns transactions that match our join intents
   * Also returns the latest LT processed for tracking
   */
  async checkIncomingTransactions(
    escrowAddress: string,
    sinceLt?: string
  ): Promise<{ matches: TransactionMatch[]; latestLt: string | null }> {
    try {
      // Use TonCenter API (free, stable). getTransactions?address=...
      const params = new URLSearchParams();
      params.append('address', escrowAddress);
      params.append('limit', '100');
      // Note: TonCenter returns newest first. We filter by sinceLt in the loop.

      const url = `${this.tonCenterUrl}/getTransactions?${params.toString()}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`TonCenter error: ${response.status} ${errorText}`);
        throw new Error(`Failed to fetch transactions: ${response.status}`);
      }

      const data = (await response.json()) as {
        ok?: boolean;
        result?: TonCenterTransaction[];
        description?: string;
      };

      if (!data.ok || !data.result || data.result.length === 0) {
        return { matches: [], latestLt: sinceLt || null };
      }

      // Map TonCenter format to our TonTransaction format
      const transactions: TonTransaction[] = data.result.map((tc) => {
        const comment = tc.in_msg?.message ? this.decodeCommentFromBase64(tc.in_msg.message) : null;
        return {
          hash: tc.transaction_id?.hash || '',
          lt: tc.transaction_id?.lt || '',
          account: { address: escrowAddress },
          inMsg: tc.in_msg
            ? {
                value: tc.in_msg.value,
                destination: tc.in_msg.destination ? { address: tc.in_msg.destination } : undefined,
                source: tc.in_msg.source ? { address: tc.in_msg.source } : undefined,
                message: comment ? { msg_data: { text: comment } } : undefined,
              }
            : undefined,
          blockTime: tc.utime || 0,
        };
      });

      // Extract nonces and roomIds from all active CREATED intents
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
          onChainRoomId: true,
        },
      });

      // Create map: nonce -> { intentId, onChainRoomId }
      const nonceMap = new Map(
        activeIntents.map(intent => [
          intent.nonce,
          { intentId: intent.id, onChainRoomId: intent.onChainRoomId },
        ])
      );

      // Match transactions with intents
      const matches: TransactionMatch[] = [];

      for (const tx of transactions) {
        // Skip if we've already processed (when sinceLt is set)
        if (sinceLt && tx.lt && BigInt(tx.lt) <= BigInt(sinceLt)) continue;
        // Check if transaction has a comment (in inMsg message data)
        const comment = this.extractComment(tx);
        
        if (!comment) {
          continue;
        }

        // Extract roomId and nonce from comment (format: "join:{roomId}:{nonce}")
        const parsed = this.extractRoomIdAndNonceFromComment(comment);
        if (!parsed) {
          continue;
        }

        const { roomId, nonce } = parsed;

        // Find intent by nonce
        const intentData = nonceMap.get(nonce);
        if (!intentData) {
          continue;
        }

        // Verify roomId matches (security check)
        if (!intentData.onChainRoomId || intentData.onChainRoomId !== roomId) {
          console.error(`⚠️ RoomId mismatch for intent ${intentData.intentId}: expected ${intentData.onChainRoomId}, got ${roomId}`);
          continue;
        }

        // CRITICAL: Verify transaction destination is escrow address
        // Must check that deposit actually went to escrow, not somewhere else
        if (!this.verifyEscrowDestination(tx, escrowAddress)) {
          console.warn(`⚠️ Transaction ${tx.hash} destination is not escrow address ${escrowAddress}. Skipping.`);
          continue;
        }

        // Extract amount from inMsg.value ONLY (CRITICAL: not from outMessages)
        const amount = this.extractAmount(tx);
        if (!amount) {
          console.warn(`⚠️ Transaction ${tx.hash} has no inMsg.value. Skipping.`);
          continue;
        }

        const fromAddress = tx.inMsg?.source?.address || tx.from?.address || '';
        if (!fromAddress) {
          console.warn(`⚠️ Transaction ${tx.hash} has no source address. Skipping.`);
          continue;
        }

        matches.push({
          intentId: intentData.intentId,
          nonce,
          txHash: tx.hash,
          fromAddress,
          amount,
          blockTime: tx.blockTime || 0,
        });
      }

      // Find the latest LT from all processed transactions
      let latestLt: string | null = null;
      for (const tx of transactions) {
        if (tx.lt && (!latestLt || BigInt(tx.lt) > BigInt(latestLt))) {
          latestLt = tx.lt;
        }
      }

      return {
        matches,
        latestLt: latestLt || sinceLt || null, // Use latest LT or keep sinceLt
      };
    } catch (error) {
      console.error('Error checking incoming transactions:', error);
      throw error;
    }
  }

  /**
   * Extract comment from transaction message
   */
  private extractComment(tx: TonTransaction): string | null {
    // Check inMsg message data for text comment
    const text = tx.inMsg?.message?.msg_data?.text;
    if (text) {
      return text;
    }

    // TODO: Handle other message formats (body, etc.)
    // For now, return null if no text found
    return null;
  }

  /**
   * Extract roomId and nonce from comment
   * Format: "join:{roomId}:{nonce}"
   * Example: "join:115885390262228992:9912312"
   * 
   * @returns { roomId: string, nonce: string } or null if format invalid
   */
  private extractRoomIdAndNonceFromComment(comment: string): { roomId: string; nonce: string } | null {
    // Remove any whitespace
    const trimmed = comment.trim();

    // Try new format "join:{roomId}:{nonce}"
    if (trimmed.startsWith('join:')) {
      const parts = trimmed.substring(5).split(':');
      if (parts.length === 2) {
        const [roomId, nonce] = parts;
        // Validate nonce is 64 hex characters
        if (/^[0-9a-fA-F]{64}$/.test(nonce)) {
          return { roomId, nonce };
        }
      }
      return null;
    }

    // Fallback: try old format "join:{nonce}" for backward compatibility
    if (trimmed.startsWith('join:')) {
      const nonce = trimmed.substring(5);
      if (/^[0-9a-fA-F]{64}$/.test(nonce)) {
        // Return null for old format - we need roomId now
        return null;
      }
    }

    // Try direct nonce (hex string, 64 characters) - deprecated
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return null; // Old format without roomId
    }

    return null;
  }

  /**
   * Extract nonce from comment (backward compatibility)
   * @deprecated Use extractRoomIdAndNonceFromComment instead
   */
  private extractNonceFromComment(comment: string): string | null {
    const result = this.extractRoomIdAndNonceFromComment(comment);
    return result?.nonce || null;
  }

  /**
   * Extract amount from transaction
   * Returns amount in nanotons as string
   * 
   * CRITICAL: Use ONLY inMsg.value for deposits to escrow address.
   * Do NOT use outMessages - they can be internal transfers/notifications
   * and don't represent the actual deposit amount from the player.
   * 
   * For deposits:
   * - amount = inMsg.value (amount sent TO escrow address)
   * - inMsg.destination must be escrow address (verified separately)
   */
  private extractAmount(tx: TonTransaction): string | null {
    // CRITICAL: Only use inMsg.value for deposits
    // Do not use outMessages - they can be internal transfers
    if (tx.inMsg?.value) {
      const value = typeof tx.inMsg.value === 'string' 
        ? tx.inMsg.value 
        : tx.inMsg.value.toString();
      return value;
    }

    // If no inMsg.value, this is not a valid deposit transaction
    return null;
  }

  /**
   * Verify transaction destination is escrow address
   * CRITICAL: Must check that deposit actually went to escrow, not somewhere else
   */
  private verifyEscrowDestination(tx: TonTransaction, escrowAddress: string): boolean {
    // Check inMsg.destination (most reliable)
    if (tx.inMsg?.destination?.address) {
      return tx.inMsg.destination.address === escrowAddress;
    }

    // Fallback: check account.address (should be escrow for incoming transactions)
    if (tx.account?.address) {
      return tx.account.address === escrowAddress;
    }

    // If we can't verify destination, reject (safety first)
    return false;
  }

  /**
   * Match transaction to intent by nonce and roomId
   * Format: join:{roomId}:{nonce}
   * Validates that intent.onChainRoomId matches roomId from comment
   */
  async matchTransactionToIntent(
    txHash: string,
    comment: string
  ): Promise<{ intentId: string; nonce: string; roomId: string } | null> {
    const parsed = this.extractRoomIdAndNonceFromComment(comment);
    if (!parsed) {
      return null;
    }

    const { roomId, nonce } = parsed;

    // Find intent by nonce
    const intent = await joinIntentService.getIntentByNonce(nonce);
    if (!intent || intent.status !== 'CREATED') {
      return null;
    }

    // Verify roomId matches (important security check)
    if (!intent.onChainRoomId || intent.onChainRoomId !== roomId) {
      console.error(`⚠️ RoomId mismatch for intent ${intent.id}: expected ${intent.onChainRoomId}, got ${roomId}`);
      return null;
    }

    return {
      intentId: intent.id,
      nonce,
      roomId,
    };
  }

  /**
   * Verify transaction exists and is confirmed
   */
  async verifyTransaction(txHash: string): Promise<boolean> {
    try {
      // TonAPI v2 endpoint for transaction
      // GET /v2/blockchain/transactions/{transaction_id}
      const url = `${this.tonApiUrl}/v2/blockchain/transactions/${txHash}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json() as { hash?: string };
      
      // Transaction exists and is confirmed
      return !!data.hash;
    } catch (error) {
      console.error('Error verifying transaction:', error);
      return false;
    }
  }

  /**
   * Get transaction details
   */
  async getTransaction(txHash: string): Promise<TonTransaction | null> {
    try {
      const url = `${this.tonApiUrl}/v2/blockchain/transactions/${txHash}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as TonTransaction;
      return data;
    } catch (error) {
      console.error('Error getting transaction:', error);
      return null;
    }
  }

  /**
   * Send refund transaction (TODO: implement with wallet/mnemonic)
   * This will require admin wallet setup
   */
  async sendRefund(toAddress: string, amount: string): Promise<string> {
    // TODO: Implement using @ton/core or @ton/ton library
    // This requires:
    // 1. Admin wallet mnemonic or key
    // 2. Connection to TON network
    // 3. Transaction signing and broadcasting
    
    throw new Error('Refund transaction sending not yet implemented. Requires wallet setup.');
  }

  /**
   * Send payout transaction (TODO: implement with wallet/mnemonic)
   */
  async sendPayout(toAddress: string, amount: string): Promise<string> {
    // TODO: Implement using @ton/core or @ton/ton library
    // Similar to sendRefund
    
    throw new Error('Payout transaction sending not yet implemented. Requires wallet setup.');
  }
}

// Singleton instance
export const tonBlockchainService = new TonBlockchainService();

