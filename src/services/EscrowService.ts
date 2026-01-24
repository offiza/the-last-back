// Decimal type from Prisma (used for database operations)
// For calculations, we convert to number
// Decimal is available from Prisma client types
type Decimal = {
  toNumber(): number;
  toString(): string;
};

/**
 * Service for working with TON Smart Contract Escrow
 * Provides interface for escrow operations
 */
export class EscrowService {
  private escrowAddress: string;

  constructor() {
    const address = process.env.TON_ESCROW_ADDRESS;
    if (!address) {
      throw new Error('TON_ESCROW_ADDRESS not configured in environment');
    }
    this.escrowAddress = address;
  }

  /**
   * Get escrow contract address
   */
  getEscrowAddress(): string {
    return this.escrowAddress;
  }

  /**
   * Validate deposit amount matches expected amount
   * Accounts for small rounding differences
   */
  validateDepositAmount(
    receivedAmount: Decimal | number | string,
    expectedAmount: Decimal | number | string
  ): boolean {
    const received = typeof receivedAmount === 'string' 
      ? parseFloat(receivedAmount) 
      : typeof receivedAmount === 'object' && 'toNumber' in receivedAmount
        ? receivedAmount.toNumber()
        : receivedAmount;

    const expected = typeof expectedAmount === 'string'
      ? parseFloat(expectedAmount)
      : typeof expectedAmount === 'object' && 'toNumber' in expectedAmount
        ? expectedAmount.toNumber()
        : expectedAmount;

    // Allow small rounding difference (0.001 TON = 1,000,000 nanotons)
    const tolerance = 0.001;
    const difference = Math.abs(received - expected);

    return difference <= tolerance;
  }

  /**
   * Validate that deposit is within acceptable time window
   * (Not too old, not too far in future)
   */
  validateDepositTimestamp(blockTime: number, maxAgeMinutes: number = 10): boolean {
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const ageSeconds = now - blockTime;

    // Deposit should not be too old
    if (ageSeconds > maxAgeMinutes * 60) {
      return false;
    }

    // Deposit should not be from future (with small tolerance for clock skew)
    if (blockTime > now + 60) {
      return false;
    }

    return true;
  }

  /**
   * Get expected deposit amount for a stake (including any fees)
   * For now, stake = expected amount (no additional fees on top)
   */
  getExpectedDepositAmount(stake: number): number {
    return stake;
  }

  /**
   * Convert TON to nanotons
   */
  tonToNanotons(ton: number): string {
    return Math.floor(ton * 1_000_000_000).toString();
  }

  /**
   * Convert nanotons to TON
   */
  nanotonsToTon(nanotons: string | number): number {
    const nanos = typeof nanotons === 'string' ? parseFloat(nanotons) : nanotons;
    return nanos / 1_000_000_000;
  }
}

// Singleton instance
export const escrowService = new EscrowService();

