import { describe, it, expect } from 'vitest';
// Import after setup file has set env variables
import { escrowService } from '../EscrowService.js';

describe('EscrowService', () => {
  describe('tonToNanotons', () => {
    it('should convert TON to nanotons correctly', () => {
      expect(escrowService.tonToNanotons(1)).toBe('1000000000');
      expect(escrowService.tonToNanotons(0.1)).toBe('100000000');
      expect(escrowService.tonToNanotons(0.01)).toBe('10000000');
      expect(escrowService.tonToNanotons(0.001)).toBe('1000000');
    });

    it('should handle zero', () => {
      expect(escrowService.tonToNanotons(0)).toBe('0');
    });

    it('should handle large values', () => {
      expect(escrowService.tonToNanotons(1000)).toBe('1000000000000');
    });
  });

  describe('nanotonsToTon', () => {
    it('should convert nanotons to TON correctly', () => {
      expect(escrowService.nanotonsToTon('1000000000')).toBe(1);
      expect(escrowService.nanotonsToTon('100000000')).toBe(0.1);
      expect(escrowService.nanotonsToTon('10000000')).toBe(0.01);
      expect(escrowService.nanotonsToTon('1000000')).toBe(0.001);
    });

    it('should handle zero', () => {
      expect(escrowService.nanotonsToTon('0')).toBe(0);
    });

    it('should handle large values', () => {
      expect(escrowService.nanotonsToTon('1000000000000')).toBe(1000);
    });
  });

  describe('validateDepositAmount', () => {
    it('should validate correct deposit amount', () => {
      const result = escrowService.validateDepositAmount(0.1, 0.1);
      expect(result).toBe(true);
    });

    it('should return false for incorrect deposit amount', () => {
      const result = escrowService.validateDepositAmount(0.05, 0.1);
      expect(result).toBe(false);
    });

    it('should return false for zero amount when expected is not zero', () => {
      const result = escrowService.validateDepositAmount(0, 0.1);
      expect(result).toBe(false);
    });

    it('should allow small rounding differences', () => {
      // Tolerance is 0.001 TON
      expect(escrowService.validateDepositAmount(0.1005, 0.1)).toBe(true);
      expect(escrowService.validateDepositAmount(0.0995, 0.1)).toBe(true);
      expect(escrowService.validateDepositAmount(0.102, 0.1)).toBe(false); // > 0.001 difference
    });

    it('should handle different entry fees', () => {
      expect(escrowService.validateDepositAmount(0.1, 0.1)).toBe(true);
      expect(escrowService.validateDepositAmount(1, 1)).toBe(true);
      expect(escrowService.validateDepositAmount(0.1, 1)).toBe(false);
    });
  });

  describe('validateDepositTimestamp', () => {
    it('should validate recent timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const recentTimestamp = now - 100; // 100 seconds ago
      
      // maxAgeMinutes is in minutes, not seconds, so pass 5 for 5 minutes
      const result = escrowService.validateDepositTimestamp(recentTimestamp, 5); // 5 minute window
      expect(result).toBe(true);
    });

    it('should return false for old timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const oldTimestamp = now - 10 * 60; // 10 minutes ago
      
      // maxAgeMinutes is in minutes, not seconds, so pass 5 for 5 minutes
      const result = escrowService.validateDepositTimestamp(oldTimestamp, 5); // 5 minute window
      expect(result).toBe(false);
    });

    it('should return false for future timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const futureTimestamp = now + 100; // 100 seconds in future (more than 60s tolerance)
      
      const result = escrowService.validateDepositTimestamp(futureTimestamp, 5);
      expect(result).toBe(false);
    });

    it('should allow small clock skew for future timestamps', () => {
      const now = Math.floor(Date.now() / 1000);
      const slightlyFuture = now + 30; // 30 seconds in future (within 60s tolerance)
      
      const result = escrowService.validateDepositTimestamp(slightlyFuture, 5);
      expect(result).toBe(true);
    });
  });

  describe('getEscrowAddress', () => {
    it('should return escrow address from env', () => {
      const address = escrowService.getEscrowAddress();
      expect(address).toBeDefined();
      expect(typeof address).toBe('string');
      // TON addresses typically start with 0: or EQ
      expect(address.length).toBeGreaterThan(0);
    });
  });
});

