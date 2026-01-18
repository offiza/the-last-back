import { describe, it, expect, beforeEach, vi } from 'vitest';
import { joinIntentService } from '../JoinIntentService.js';
import { walletService } from '../WalletService.js';
import { prisma } from '../../db/prisma.js';

// Mock dependencies
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    joinIntent: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    refund: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../WalletService.js', () => ({
  walletService: {
    getWalletByPlayerId: vi.fn(),
  },
}));

describe('Refund Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create refund when player leaves waiting match', async () => {
    const playerId = 'player123';
    const matchId = 'match456';
    const walletAddress = '0:abc123def456';

    // Mock: Player has a PAID intent for the match
    const paidIntent = {
      id: 'intent789',
      roomId: matchId,
      playerId,
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
      playerId,
      address: walletAddress,
      network: 'mainnet' as const,
      publicKey: 'pubkey',
      connectedAt: new Date(),
    };

    const mockRefund = {
      id: 'refund123',
      joinIntentId: 'intent789',
      txHash: null,
      amount: 0.1,
      toAddress: walletAddress,
      status: 'CREATED',
      reason: 'player_left',
      createdAt: new Date(),
      confirmedAt: null,
    };

    // Setup mocks
    vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(paidIntent as any);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue(null);
    vi.mocked(walletService.getWalletByPlayerId).mockResolvedValue(mockWallet);
    vi.mocked(prisma.refund.create).mockResolvedValue(mockRefund as any);
    vi.mocked(prisma.joinIntent.update).mockResolvedValue({
      ...paidIntent,
      status: 'REFUNDED',
      refundedAt: new Date(),
    } as any);

    // Execute
    const refundId = await joinIntentService.createRefundForPlayer(
      playerId,
      matchId,
      'player_left'
    );

    // Assert
    expect(refundId).toBe('refund123');
    expect(prisma.joinIntent.findFirst).toHaveBeenCalledWith({
      where: {
        playerId,
        roomId: matchId,
        status: 'PAID',
      },
      orderBy: {
        paidAt: 'desc',
      },
    });
    expect(prisma.refund.create).toHaveBeenCalledWith({
      data: {
        joinIntentId: 'intent789',
        amount: 0.1,
        toAddress: walletAddress,
        status: 'CREATED',
        reason: 'player_left',
      },
    });
    expect(prisma.joinIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent789' },
      data: {
        status: 'REFUNDED',
        refundedAt: expect.any(Date),
      },
    });
  });

  it('should not create refund if intent already refunded', async () => {
    const playerId = 'player123';
    const matchId = 'match456';

    // Mock: No PAID intent found (already refunded or doesn't exist)
    vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(null);

    const refundId = await joinIntentService.createRefundForPlayer(
      playerId,
      matchId,
      'player_left'
    );

    expect(refundId).toBeNull();
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('should return existing refund if one already exists', async () => {
    const playerId = 'player123';
    const matchId = 'match456';

    const paidIntent = {
      id: 'intent789',
      roomId: matchId,
      playerId,
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
      id: 'refund456',
      joinIntentId: 'intent789',
      txHash: null,
      amount: 0.1,
      toAddress: '0:abc123',
      status: 'CREATED',
      reason: 'player_left',
      createdAt: new Date(),
      confirmedAt: null,
    };

    vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(paidIntent as any);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue(existingRefund as any);

    const refundId = await joinIntentService.createRefundForPlayer(
      playerId,
      matchId,
      'player_left'
    );

    expect(refundId).toBe('refund456');
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });

  it('should handle match_cancelled reason', async () => {
    const playerId = 'player123';
    const matchId = 'match456';

    const paidIntent = {
      id: 'intent789',
      roomId: matchId,
      playerId,
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
      playerId,
      address: '0:abc123',
      network: 'mainnet' as const,
      publicKey: 'pubkey',
      connectedAt: new Date(),
    };

    const mockRefund = {
      id: 'refund789',
      joinIntentId: 'intent789',
      amount: 0.1,
      toAddress: '0:abc123',
      status: 'CREATED',
      reason: 'match_cancelled',
      createdAt: new Date(),
    };

    vi.mocked(prisma.joinIntent.findFirst).mockResolvedValue(paidIntent as any);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue(null);
    vi.mocked(walletService.getWalletByPlayerId).mockResolvedValue(mockWallet);
    vi.mocked(prisma.refund.create).mockResolvedValue(mockRefund as any);
    vi.mocked(prisma.joinIntent.update).mockResolvedValue({
      ...paidIntent,
      status: 'REFUNDED',
    } as any);

    const refundId = await joinIntentService.createRefundForPlayer(
      playerId,
      matchId,
      'match_cancelled'
    );

    expect(refundId).toBe('refund789');
    expect(prisma.refund.create).toHaveBeenCalledWith({
      data: {
        joinIntentId: 'intent789',
        amount: 0.1,
        toAddress: '0:abc123',
        status: 'CREATED',
        reason: 'match_cancelled',
      },
    });
  });
});

