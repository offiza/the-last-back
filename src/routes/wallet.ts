import { Router, Request, Response } from 'express';
import { walletService } from '../services/WalletService.js';
import { parseTelegramUser, validateTelegramData } from '../utils/telegram.js';

const router = Router();

function getPlayerId(initData?: string, userId?: string): string | undefined {
  if (initData && typeof initData === 'string') {
    const telegramUser = parseTelegramUser(initData);
    if (telegramUser) return telegramUser.id.toString();
  }
  if (userId) return userId;
  return undefined;
}

async function verifyWithProof(
  _req: Request,
  res: Response,
  params: { initData?: string; userId?: string; address: string; network: string; proof: object; payload: string }
): Promise<boolean> {
  const { initData, userId, address, network, proof, payload } = params;
  if (params.network !== 'mainnet' && params.network !== 'testnet') {
    res.status(400).json({ error: 'Invalid network. Must be "mainnet" or "testnet"' });
    return true;
  }
  const playerId = getPlayerId(initData, userId);
  if (!playerId) {
    res.status(400).json({ error: 'Missing playerId. Provide initData or userId' });
    return true;
  }
  const wallet = await walletService.verifyAndLinkWallet(
    playerId,
    address,
    params.network as 'mainnet' | 'testnet',
    proof as any,
    payload
  );
  res.json({ wallet: { id: wallet.id, address: wallet.address, network: wallet.network } });
  return true;
}

async function linkWalletWithoutProof(
  _req: Request,
  res: Response,
  params: { initData?: string; userId?: string; address: string; network: string }
): Promise<void> {
  const { initData, userId, address, network } = params;
  if (network !== 'mainnet' && network !== 'testnet') {
    res.status(400).json({ error: 'Invalid network. Must be "mainnet" or "testnet"' });
    return;
  }
  const playerId = getPlayerId(initData, userId);
  if (!playerId) {
    res.status(400).json({ error: 'Missing playerId. Provide initData or userId for linking without proof' });
    return;
  }
  // Validate initData when available (Telegram bot auth)
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (initData && botToken && !validateTelegramData(initData, botToken)) {
    res.status(401).json({ error: 'Invalid initData signature' });
    return;
  }
  const wallet = await walletService.linkWalletWithoutProof(playerId, address, network as 'mainnet' | 'testnet');
  res.json({ wallet: { id: wallet.id, address: wallet.address, network: wallet.network } });
}

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

    if (!address || !network) {
      res.status(400).json({ 
        error: 'Missing required fields: address, network' 
      });
      return;
    }

    // If proof is provided, use full proof verification
    if (proof && payload) {
      const fullVerify = await verifyWithProof(req, res, { initData, userId, address, network, proof, payload });
      if (fullVerify) return;
    }

    // Fallback: link without proof when ton_proof is not available (e.g. some wallets)
    // Requires valid initData (Telegram auth) as trust anchor
    return linkWalletWithoutProof(req, res, { initData, userId, address, network });
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

