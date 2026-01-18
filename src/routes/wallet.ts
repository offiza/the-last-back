import { Router } from 'express';
import { walletService } from '../services/WalletService.js';
import { parseTelegramUser } from '../utils/telegram.js';

const router = Router();

/**
 * POST /api/wallet/proof/payload
 * Generate proof payload for TON Connect ton_proof
 * Body: { initData } (Telegram initData для получения playerId)
 * Response: { payload, expiresAt }
 */
router.post('/proof/payload', async (req, res) => {
  try {
    // Parse playerId from Telegram initData or use fallback
    let playerId: string | undefined;
    
    const { initData, userId } = req.body;
    
    if (initData) {
      // Parse Telegram user ID from initData
      const telegramUser = parseTelegramUser(initData);
      if (telegramUser) {
        playerId = telegramUser.id.toString();
      }
    }
    
    // Fallback to userId for development
    if (!playerId && userId) {
      playerId = userId;
    }
    
    if (!playerId) {
      res.status(400).json({ error: 'Missing playerId. Provide initData or userId' });
      return;
    }

    const proofPayload = walletService.generateProofPayload(playerId);

    res.json({
      payload: proofPayload.payload,
      expiresAt: proofPayload.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Generate proof payload error:', error);
    res.status(500).json({ error: 'Failed to generate proof payload' });
  }
});

/**
 * POST /api/wallet/proof/verify
 * Verify ton_proof and link wallet to player
 * Body: { initData, address, network, proof, payload }
 * Response: { wallet: { id, address, network } }
 */
router.post('/proof/verify', async (req, res) => {
  try {
    const { initData, userId, address, network, proof, payload } = req.body;

    if (!address || !network || !proof || !payload) {
      res.status(400).json({ 
        error: 'Missing required fields: address, network, proof, payload' 
      });
      return;
    }

    if (network !== 'mainnet' && network !== 'testnet') {
      res.status(400).json({ error: 'Invalid network. Must be "mainnet" or "testnet"' });
      return;
    }

    // Parse playerId from Telegram initData or use fallback
    let playerId: string | undefined;
    
    if (initData && typeof initData === 'string') {
      const telegramUser = parseTelegramUser(initData);
      if (telegramUser) {
        playerId = telegramUser.id.toString();
      }
    }
    
    // Fallback to userId for development
    if (!playerId && userId) {
      playerId = userId;
    }
    
    if (!playerId) {
      res.status(400).json({ error: 'Missing playerId. Provide initData or userId' });
      return;
    }

    const wallet = await walletService.verifyAndLinkWallet(
      playerId,
      address,
      network,
      proof,
      payload
    );

    res.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        network: wallet.network,
      },
    });
  } catch (error) {
    console.error('Verify wallet proof error:', error);
    
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }
    
    res.status(500).json({ error: 'Failed to verify wallet proof' });
  }
});

/**
 * GET /api/wallet/status
 * Check if player has connected wallet
 * Query: ?playerId=xxx or use initData
 * Response: { hasWallet: boolean, wallet?: { address, network } }
 */
router.get('/status', async (req, res) => {
  try {
    let playerId: string | undefined;
    
    const { playerId: queryPlayerId, initData } = req.query;
    
    if (initData && typeof initData === 'string') {
      const telegramUser = parseTelegramUser(initData);
      if (telegramUser) {
        playerId = telegramUser.id.toString();
      }
    }
    
    if (!playerId && queryPlayerId) {
      playerId = queryPlayerId as string;
    }
    
    if (!playerId) {
      res.status(400).json({ error: 'Missing playerId. Provide playerId query param or initData' });
      return;
    }

    const wallet = await walletService.getWalletByPlayerId(playerId);

    if (!wallet) {
      res.json({ hasWallet: false });
      return;
    }

    res.json({
      hasWallet: true,
      wallet: {
        address: wallet.address,
        network: wallet.network,
      },
    });
  } catch (error) {
    console.error('Get wallet status error:', error);
    res.status(500).json({ error: 'Failed to get wallet status' });
  }
});

export default router;

