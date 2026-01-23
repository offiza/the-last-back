import { Router } from 'express';
import { joinIntentService } from '../services/JoinIntentService.js';
import { parseTelegramUser } from '../utils/telegram.js';

const router = Router();

/**
 * POST /api/rooms/:roomType/join-intent
 * Create join intent for TON room
 * Body: { initData?, userId? }
 * Response: { intent: { id, status, expiresAt, ... }, paymentParams: { to, amount, comment } }
 */
router.post('/rooms/:roomType/join-intent', async (req, res) => {
  try {
    const { roomType } = req.params;
    const { initData, userId, userName } = req.body;

    if (roomType !== 'ton') {
      res.status(400).json({ error: 'Join intent is only available for TON rooms' });
      return;
    }

    // Parse playerId and playerName from Telegram initData or use fallback
    let playerId: string | undefined;
    let playerName: string = userName || 'Player';

    if (initData) {
      const telegramUser = parseTelegramUser(initData);
      if (telegramUser) {
        playerId = telegramUser.id.toString();
        playerName = telegramUser.first_name || playerName;
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

    const { intent, paymentParams } = await joinIntentService.createJoinIntent(playerId, playerName, 'ton');

    res.json({
      intent: {
        id: intent.id,
        status: intent.status,
        expiresAt: intent.expiresAt.toISOString(),
        stake: intent.stake,
        nonce: intent.nonce,
      },
      paymentParams,
    });
  } catch (error) {
    console.error('Create join intent error:', error);

    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: 'Failed to create join intent' });
  }
});

/**
 * GET /api/join-intent/:id
 * Get join intent status
 * Response: { intent: { id, status, expiresAt, paidAt, ... } }
 */
router.get('/join-intent/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const intent = await joinIntentService.getIntent(id);

    if (!intent) {
      res.status(404).json({ error: 'Join intent not found' });
      return;
    }

    res.json({
      intent: {
        id: intent.id,
        status: intent.status,
        expiresAt: intent.expiresAt.toISOString(),
        stake: intent.stake,
        paidAt: intent.paidAt?.toISOString() || null,
        roomId: intent.roomId,
      },
    });
  } catch (error) {
    console.error('Get join intent error:', error);
    res.status(500).json({ error: 'Failed to get join intent' });
  }
});

export default router;

