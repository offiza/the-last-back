import { describe, it, expect, beforeEach, vi } from 'vitest';

// Set env variable before any imports
process.env.TON_ESCROW_ADDRESS = '0:test_escrow_address_for_testing';

import { joinIntentService } from '../JoinIntentService.js';
import { walletService } from '../WalletService.js';
import { prisma } from '../../db/prisma.js';

// Mock dependencies
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    joinIntent: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    refund: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../WalletService.js', () => ({
  walletService: {
    getWalletByPlayerId: vi.fn(),
  },
}));

describe('JoinIntentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createJoinIntent', () => {
    it('should throw error if wallet not connected', async () => {
      vi.mocked(walletService.getWalletByPlayerId).mockResolvedValue(null);

      await expect(
        joinIntentService.createJoinIntent('player123', 'Player', 'ton')
      ).rejects.toThrow('Wallet not connected');
    });

    it('should create intent with correct nonce format', async () => {
      const mockWallet = {
        id: 'wallet1',
        playerId: 'player123',
        address: '0:abc123',
        network: 'mainnet' as const,
        publicKey: 'pubkey',
        connectedAt: new Date(),
      };

      vi.mocked(walletService.getWalletByPlayerId).mockResolvedValue(mockWallet);
      vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(null);

      // Generate a valid 64-character hex nonce for the mock
      const validNonce = 'a'.repeat(64); // 64 hex characters
      const mockIntent = {
        id: 'intent1',
        roomId: null,
        playerId: 'player123',
        walletId: 'wallet1',
        roomType: 'ton',
        stake: 0.1,
        nonce: validNonce,
        status: 'CREATED',
        expiresAt: new Date(),
        createdAt: new Date(),
        paidAt: null,
      };

      // Mock the create to return intent with the nonce that will be generated
      // We need to capture the actual nonce that will be generated
      vi.mocked(prisma.joinIntent.create).mockResolvedValue({
        ...mockIntent,
        onChainRoomId: null,
        cancelledAt: null,
        refundedAt: null,
      } as any);

      const result = await joinIntentService.createJoinIntent('player123', 'Player', 'ton');

      expect(result.intent).toBeDefined();
      expect(result.paymentParams).toBeDefined();
      // Comment format is "join:{nonce}" where nonce is 64 hex characters
      expect(result.paymentParams.comment).toMatch(/^join:[0-9a-f]{64}$/);
      expect(result.paymentParams.amount).toBeDefined();
      expect(prisma.joinIntent.create).toHaveBeenCalled();
    });

    it('should return existing active intent if one exists', async () => {
      const mockWallet = {
        id: 'wallet1',
        playerId: 'player123',
        address: '0:abc123',
        network: 'mainnet' as const,
        publicKey: 'pubkey',
        connectedAt: new Date(),
      };

      const existingIntent = {
        id: 'existing1',
        roomId: null,
        playerId: 'player123',
        walletId: 'wallet1',
        roomType: 'ton',
        stake: 0.1,
        nonce: 'nonce123',
        status: 'CREATED',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        createdAt: new Date(),
        paidAt: null,
      };

      vi.mocked(walletService.getWalletByPlayerId).mockResolvedValue(mockWallet);
      vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(existingIntent as any);

      const result = await joinIntentService.createJoinIntent('player123', 'Player', 'ton');

      expect(result.intent.id).toBe('existing1');
      expect(prisma.joinIntent.create).not.toHaveBeenCalled();
    });
  });

  describe('getPaidIntentForJoin', () => {
    it('should return null if no paid intent found', async () => {
      vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(null);

      const result = await joinIntentService.getPaidIntentForJoin('player123', 'match1', 'ton');

      expect(result).toBeNull();
    });

    it('should return paid intent if found', async () => {
      const mockIntent = {
        id: 'intent1',
        roomId: null,
        playerId: 'player123',
        walletId: 'wallet1',
        roomType: 'ton',
        stake: 0.1,
        nonce: 'nonce123',
        status: 'PAID',
        expiresAt: new Date(),
        createdAt: new Date(),
        paidAt: new Date(),
      };

      vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(mockIntent as any);

      const result = await joinIntentService.getPaidIntentForJoin('player123', 'match1', 'ton');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('intent1');
      expect(result?.status).toBe('PAID');
      expect(prisma.joinIntent.findFirst).toHaveBeenCalledWith({
        where: {
          playerId: 'player123',
          roomType: 'ton',
          status: 'PAID',
          roomId: null,
        },
        orderBy: {
          paidAt: 'desc',
        },
      });
    });
  });

  describe('createRefundForPlayer', () => {
    it('should return null if no paid intent found', async () => {
      vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(null);

      const result = await joinIntentService.createRefundForPlayer('player123', 'match1');

      expect(result).toBeNull();
    });

    it('should return existing refund ID if refund already exists', async () => {
      const mockIntent = {
        id: 'intent1',
        roomId: 'match1',
        playerId: 'player123',
        walletId: 'wallet1',
        roomType: 'ton',
        stake: 0.1,
        nonce: 'nonce123',
        status: 'PAID',
        expiresAt: new Date(),
        createdAt: new Date(),
        paidAt: new Date(),
      };

      const existingRefund = {
        id: 'refund1',
        joinIntentId: 'intent1',
        amount: 0.1,
        toAddress: '0:abc123',
        status: 'CREATED',
        reason: 'player_left',
        createdAt: new Date(),
        confirmedAt: null,
      };

      vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(mockIntent as any);
      vi.mocked(prisma.refund.findUnique).mockResolvedValue(existingRefund as any);

      const result = await joinIntentService.createRefundForPlayer('player123', 'match1');

      expect(result).toBe('refund1');
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('should create refund and update intent status', async () => {
      const mockIntent = {
        id: 'intent1',
        roomId: 'match1',
        playerId: 'player123',
        walletId: 'wallet1',
        roomType: 'ton',
        stake: 0.1,
        nonce: 'nonce123',
        status: 'PAID',
        expiresAt: new Date(),
        createdAt: new Date(),
        paidAt: new Date(),
      };

      const mockWallet = {
        id: 'wallet1',
        playerId: 'player123',
        address: '0:abc123',
        network: 'mainnet' as const,
        publicKey: 'pubkey',
        connectedAt: new Date(),
      };

      const mockRefund = {
        id: 'refund1',
        joinIntentId: 'intent1',
        amount: 0.1,
        toAddress: '0:abc123',
        status: 'CREATED',
        reason: 'player_left',
        createdAt: new Date(),
        confirmedAt: null,
      };

      vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(mockIntent as any);
      vi.mocked(prisma.refund.findUnique).mockResolvedValue(null);
      vi.mocked(walletService.getWalletByPlayerId).mockResolvedValue(mockWallet);
      vi.mocked(prisma.refund.create).mockResolvedValue(mockRefund as any);
      vi.mocked(prisma.joinIntent.update).mockResolvedValue({
        ...mockIntent,
        status: 'REFUNDED',
        refundedAt: new Date(),
      } as any);

      const result = await joinIntentService.createRefundForPlayer('player123', 'match1');

      expect(result).toBe('refund1');
      expect(prisma.refund.create).toHaveBeenCalledWith({
        data: {
          joinIntentId: 'intent1',
          amount: 0.1,
          toAddress: '0:abc123',
          status: 'CREATED',
          reason: 'player_left',
        },
      });
      expect(prisma.joinIntent.update).toHaveBeenCalledWith({
        where: { id: 'intent1' },
        data: {
          status: 'REFUNDED',
          refundedAt: expect.any(Date),
        },
      });
    });
  });

  describe('markIntentPaid', () => {
    it('should throw error if intent not found', async () => {
      vi.mocked(prisma.joinIntent.findUnique).mockResolvedValue(null);

      await expect(
        joinIntentService.markIntentPaid('intent1', 'txhash123')
      ).rejects.toThrow('Intent intent1 not found');
    });

    it('should throw error if intent not in CREATED status', async () => {
      const mockIntent = {
        id: 'intent1',
        status: 'PAID',
      };

      vi.mocked(prisma.joinIntent.findUnique).mockResolvedValue(mockIntent as any);

      await expect(
        joinIntentService.markIntentPaid('intent1', 'txhash123')
      ).rejects.toThrow('is not in CREATED status');
    });

    it('should mark intent as PAID', async () => {
      const mockIntent = {
        id: 'intent1',
        status: 'CREATED',
      };

      const updatedIntent = {
        ...mockIntent,
        status: 'PAID',
        paidAt: new Date(),
      };

      vi.mocked(prisma.joinIntent.findUnique).mockResolvedValue(mockIntent as any);
      vi.mocked(prisma.joinIntent.update).mockResolvedValue(updatedIntent as any);

      const result = await joinIntentService.markIntentPaid('intent1', 'txhash123');

      expect(result.status).toBe('PAID');
      expect(prisma.joinIntent.update).toHaveBeenCalledWith({
        where: { id: 'intent1' },
        data: {
          status: 'PAID',
          paidAt: expect.any(Date),
        },
      });
    });
  });
});

