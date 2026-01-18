import { joinIntentService } from './JoinIntentService.js';
import { prisma } from '../db/prisma.js';

export interface TonTransaction {
  hash: string;
  lt: string;
  from?: {
    address: string;
  };
  outMessages?: Array<{
    destination?: {
      address: string;
    };
  }>;
  inMsg?: {
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
}

/**
 * Service for interacting with TON blockchain via TonAPI
 * Handles transaction monitoring and verification
 */
export class TonBlockchainService {
  private tonApiUrl: string;
  private tonApiKey: string | null;

  constructor() {
    // TonAPI base URL
    // Mainnet: https://tonapi.io
    // Testnet: https://testnet.tonapi.io
    this.tonApiUrl = process.env.TON_API_URL || 'https://tonapi.io';
    
    // TonAPI key (optional, but recommended for higher rate limits)
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
   * Check incoming transactions to escrow address
   * Returns transactions that match our join intents
   */
  async checkIncomingTransactions(
    escrowAddress: string,
    sinceLt?: string
  ): Promise<TransactionMatch[]> {
    try {
      // TonAPI v2 endpoint for account transactions
      // GET /v2/accounts/{account_id}/transactions
      const url = `${this.tonApiUrl}/v2/accounts/${escrowAddress}/transactions`;
      
      const params = new URLSearchParams();
      if (sinceLt) {
        params.append('after_lt', sinceLt);
      }
      // Limit to last 100 transactions
      params.append('limit', '100');

      const response = await fetch(`${url}?${params.toString()}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`TonAPI error: ${response.status} ${errorText}`);
        throw new Error(`Failed to fetch transactions: ${response.status}`);
      }

      const data = await response.json() as { transactions?: TonTransaction[] };

      if (!data.transactions || data.transactions.length === 0) {
        return [];
      }

      // Extract nonces from all active CREATED intents
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
        },
      });

      const nonceMap = new Map(activeIntents.map(intent => [intent.nonce, intent.id]));

      // Match transactions with intents
      const matches: TransactionMatch[] = [];

      for (const tx of data.transactions) {
        // Check if transaction has a comment (in inMsg message data)
        const comment = this.extractComment(tx);
        
        if (!comment) {
          continue;
        }

        // Extract nonce from comment (format: "join:{nonce}")
        const nonce = this.extractNonceFromComment(comment);
        if (!nonce || !nonceMap.has(nonce)) {
          continue;
        }

        const intentId = nonceMap.get(nonce)!;
        const fromAddress = tx.inMsg?.source?.address || tx.from?.address || '';
        const amount = this.extractAmount(tx);

        if (!fromAddress || !amount) {
          continue;
        }

        matches.push({
          intentId,
          nonce,
          txHash: tx.hash,
          fromAddress,
          amount,
        });
      }

      return matches;
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
   * Extract nonce from comment
   * Format: "join:{nonce}" or just "{nonce}"
   */
  private extractNonceFromComment(comment: string): string | null {
    // Remove any whitespace
    const trimmed = comment.trim();

    // Try format "join:{nonce}"
    if (trimmed.startsWith('join:')) {
      return trimmed.substring(5);
    }

    // Try direct nonce (hex string, 64 characters)
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return trimmed;
    }

    return null;
  }

  /**
   * Extract amount from transaction
   * Returns amount in nanotons as string
   */
  private extractAmount(tx: TonTransaction): string | null {
    // Amount is typically in the inMsg or transaction value
    // For now, we'll need to parse from transaction structure
    // This might need adjustment based on actual TonAPI response format
    
    // TODO: Parse actual amount from transaction
    // For now, return null - we'll need to check actual TonAPI response structure
    return null;
  }

  /**
   * Match transaction to intent by nonce
   */
  async matchTransactionToIntent(
    txHash: string,
    comment: string
  ): Promise<{ intentId: string; nonce: string } | null> {
    const nonce = this.extractNonceFromComment(comment);
    if (!nonce) {
      return null;
    }

    const intent = await joinIntentService.getIntentByNonce(nonce);
    if (!intent || intent.status !== 'CREATED') {
      return null;
    }

    return {
      intentId: intent.id,
      nonce,
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

      const data = await response.json();
      
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

