import { describe, it, expect, beforeEach, vi } from 'vitest';
import { walletService } from '../WalletService.js';
import { prisma } from '../../db/prisma.js';

// Mock dependencies
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    wallet: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@tonconnect/sdk', () => ({
  TonConnect: vi.fn().mockImplementation(() => ({
    connectWallet: vi.fn(),
    restoreConnection: vi.fn(),
  })),
  CHAIN: {
    MAINNET: 'mainnet',
    TESTNET: 'testnet',
  },
}));

describe('WalletService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateProofPayload', () => {
    it('should generate proof payload with correct structure', () => {
      const playerId = 'player123';
      const result = walletService.generateProofPayload(playerId);

      expect(result).toHaveProperty('payload');
      expect(result).toHaveProperty('expiresAt');
      expect(typeof result.payload).toBe('string');
      expect(result.expiresAt).toBeInstanceOf(Date);
      
      // Decode payload to verify structure
      const payloadData = JSON.parse(Buffer.from(result.payload, 'base64').toString('utf-8'));
      expect(payloadData).toHaveProperty('nonce');
      expect(payloadData).toHaveProperty('playerId');
      expect(payloadData).toHaveProperty('timestamp');
      expect(payloadData.playerId).toBe(playerId);
    });

    it('should generate unique payloads on each call', () => {
      const playerId = 'player123';
      const payload1 = walletService.generateProofPayload(playerId);
      const payload2 = walletService.generateProofPayload(playerId);

      // Decode and compare nonces (they should be different)
      const data1 = JSON.parse(Buffer.from(payload1.payload, 'base64').toString('utf-8'));
      const data2 = JSON.parse(Buffer.from(payload2.payload, 'base64').toString('utf-8'));

      // Nonces must be unique
      expect(data1.nonce).not.toBe(data2.nonce);
      // Timestamps might be the same if called very quickly, so we only check nonce
    });
  });

  describe('getWalletByPlayerId', () => {
    it('should return null if wallet not found', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValue(null);

      const result = await walletService.getWalletByPlayerId('player123');

      expect(result).toBeNull();
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { playerId: 'player123' },
      });
    });

    it('should return wallet if found', async () => {
      const mockWallet = {
        id: 'wallet1',
        playerId: 'player123',
        address: '0:abc123',
        network: 'mainnet',
        publicKey: 'pubkey123',
        connectedAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.wallet.findUnique).mockResolvedValue(mockWallet as any);

      const result = await walletService.getWalletByPlayerId('player123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('wallet1');
      expect(result?.playerId).toBe('player123');
      expect(result?.address).toBe('0:abc123');
    });
  });

  describe('hasWallet', () => {
    it('should return false if wallet not found', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValue(null);

      const result = await walletService.hasWallet('player123');

      expect(result).toBe(false);
    });

    it('should return true if wallet exists', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValue({
        id: 'wallet1',
      } as any);

      const result = await walletService.hasWallet('player123');

      expect(result).toBe(true);
    });
  });
});

