import { Router } from 'express';
import { paymentService } from '../services/PaymentService.js';
import { matchmaker } from '../services/Matchmaker.js';
import { ROOM_PRESETS } from '../constants/rooms.js';

const router = Router();

/**
 * POST /api/payments/verify
 * Verify payment request from client
 * Body: { matchId, playerId, signature }
 */
router.post('/verify', async (req, res) => {
  try {
    const { matchId, playerId, signature } = req.body;

    if (!matchId || !playerId || !signature) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const payment = await paymentService.verifyPaymentRequest(matchId, playerId, signature);

    if (!payment) {
      res.status(404).json({ error: 'Payment not found or invalid signature' });
      return;
    }

    // Return payment info (without sensitive data)
    res.json({
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      verified: payment.verified,
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

/**
 * GET /api/payments/match/:matchId
 * Get payment data for a match (winners only)
 */
router.get('/match/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = matchmaker.getMatch(matchId);

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    if (match.status !== 'finished') {
      res.status(400).json({ error: 'Match is not finished' });
      return;
    }

    const paymentData = await paymentService.getMatchPayment(matchId);

    if (!paymentData) {
      res.status(404).json({ error: 'Payment data not found for this match' });
      return;
    }

    // Return payment data with signature for verification
    res.json({
      matchId: paymentData.matchId,
      winners: paymentData.winners,
      totalBank: paymentData.totalBank,
      payout: paymentData.payout,
      timestamp: paymentData.timestamp,
      signature: paymentData.signature, // Client can verify this
    });
  } catch (error) {
    console.error('Get match payment error:', error);
    res.status(500).json({ error: 'Failed to get match payment data' });
  }
});

/**
 * GET /api/payments/player/:playerId
 * Get all payments for a player
 */
router.get('/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const payments = await paymentService.getPlayerPayments(playerId);

    // Return only non-sensitive data
    res.json({
      payments: payments.map((p) => ({
        id: p.id,
        matchId: p.matchId,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        timestamp: p.timestamp,
      })),
    });
  } catch (error) {
    console.error('Get player payments error:', error);
    res.status(500).json({ error: 'Failed to get player payments' });
  }
});

/**
 * POST /api/payments/create-entry
 * Create entry payment for joining paid room
 * Body: { playerId, playerName, roomType }
 */
router.post('/create-entry', async (req, res) => {
  try {
    const { playerId, playerName, roomType } = req.body;

    if (!playerId || !playerName || !roomType) {
      res.status(400).json({ error: 'Missing required fields: playerId, playerName, roomType' });
      return;
    }

    if (roomType !== 'stars' && roomType !== 'ton') {
      res.status(400).json({ error: 'Invalid roomType. Must be "stars" or "ton"' });
      return;
    }

    // Find room preset
    const preset = ROOM_PRESETS.find((p) => p.type === roomType);
    if (!preset) {
      res.status(404).json({ error: `Room preset not found for type: ${roomType}` });
      return;
    }

    // Create entry payment
    const { paymentId, signature } = await paymentService.createEntryPayment(
      playerId,
      playerName,
      roomType,
      preset.entryFee
    );

    // For Telegram Stars: Create invoice link via Bot API
    // For TON: Return payment details for client-side wallet integration
    let invoiceUrl: string | null = null;
    if (roomType === 'stars') {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        // Create invoice link using Telegram Bot API
        try {
          const response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: `Entry fee: ${preset.entryFee} Stars`,
              description: `Join ${roomType} room in LAST Game`,
              payload: paymentId, // Use paymentId as payload for verification
              provider_token: '', // Not needed for Stars
              currency: 'XTR', // Telegram Stars currency code
              prices: [{ label: 'Entry fee', amount: preset.entryFee * 100 }], // Amount in cents/units
            }),
          });

          const data = await response.json() as { ok: boolean; result?: string; description?: string };
          if (data.ok && data.result) {
            invoiceUrl = data.result;
          } else {
            console.error('Failed to create invoice link:', data);
          }
        } catch (error) {
          console.error('Error creating invoice link:', error);
          // Continue without invoice URL for development
        }
      }
    }

    res.json({
      paymentId,
      signature,
      amount: preset.entryFee,
      currency: roomType,
      invoiceUrl, // For Stars: URL to open invoice, for TON: null (use wallet)
    });
  } catch (error) {
    console.error('Create entry payment error:', error);
    res.status(500).json({ error: 'Failed to create entry payment' });
  }
});

/**
 * POST /api/payments/verify-entry
 * Verify entry payment before joining room
 * Body: { paymentId, playerId, signature }
 */
router.post('/verify-entry', async (req, res) => {
  try {
    const { paymentId, playerId, signature } = req.body;

    if (!paymentId || !playerId || !signature) {
      res.status(400).json({ error: 'Missing required fields: paymentId, playerId, signature' });
      return;
    }

    const verified = await paymentService.verifyEntryPayment(paymentId, playerId, signature);

    if (!verified) {
      res.status(400).json({ error: 'Payment verification failed' });
      return;
    }

    res.json({ verified: true, paymentId });
  } catch (error) {
    console.error('Verify entry payment error:', error);
    res.status(500).json({ error: 'Failed to verify entry payment' });
  }
});

/**
 * GET /api/payments/winnings/:matchId/:playerId
 * Get winnings information for a player in a match
 */
router.get('/winnings/:matchId/:playerId', async (req, res) => {
  try {
    const { matchId, playerId } = req.params;

    // Check if player is a winner
    const isWinner = await paymentService.isPlayerWinner(matchId, playerId);
    if (!isWinner) {
      res.status(404).json({ error: 'Player is not a winner in this match' });
      return;
    }

    // Get winner payment
    const payment = await paymentService.getWinnerPayment(matchId, playerId);
    if (!payment) {
      res.status(404).json({ error: 'Winner payment not found' });
      return;
    }

    // Get match payment data
    const matchPayment = await paymentService.getMatchPayment(matchId);
    if (!matchPayment) {
      res.status(404).json({ error: 'Match payment data not found' });
      return;
    }

    res.json({
      matchId,
      playerId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      payout: matchPayment.payout,
      totalBank: matchPayment.totalBank,
    });
  } catch (error) {
    console.error('Get winnings error:', error);
    res.status(500).json({ error: 'Failed to get winnings' });
  }
});

/**
 * POST /api/payments/claim-winnings
 * Claim winnings (request payout)
 * Body: { matchId, playerId }
 */
router.post('/claim-winnings', async (req, res) => {
  try {
    const { matchId, playerId } = req.body;

    if (!matchId || !playerId) {
      res.status(400).json({ error: 'Missing required fields: matchId, playerId' });
      return;
    }

    // Check if player is a winner
    const isWinner = await paymentService.isPlayerWinner(matchId, playerId);
    if (!isWinner) {
      res.status(403).json({ error: 'Player is not a winner in this match' });
      return;
    }

    // Get winner payment
    const payment = await paymentService.getWinnerPayment(matchId, playerId);
    if (!payment) {
      res.status(404).json({ error: 'Winner payment not found' });
      return;
    }

    // Check if already paid
    if (payment.status === 'completed') {
      res.status(400).json({ error: 'Winnings already claimed' });
      return;
    }

    // For Telegram Stars: Create invoice for payout
    // For TON: Return payment details for wallet integration
    let invoiceUrl: string | null = null;
    
    if (payment.currency === 'stars') {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        try {
          // Note: Telegram Bot API doesn't support sending Stars directly to users
          // You would need to use a different approach, e.g., Stars Transfer API
          // For now, we'll create a response that indicates the amount
          console.log(`💰 Should send ${payment.amount} Stars to player ${playerId}`);
          // In production, you would integrate with Stars Transfer API here
          // For MVP, we'll mark as completed (assuming manual processing)
        } catch (error) {
          console.error('Error processing Stars payout:', error);
          // Continue anyway for development
        }
      }
    } else if (payment.currency === 'ton') {
      // For TON, return payment details for wallet integration
      // The client will handle the wallet transaction
      console.log(`💰 Should send ${payment.amount} TON to player ${playerId}`);
    }

    // Mark payment as completed (in production, this would happen after actual payment)
    await paymentService.markWinnerPaymentSent(matchId, playerId);

    res.json({
      success: true,
      matchId,
      playerId,
      amount: payment.amount,
      currency: payment.currency,
      invoiceUrl, // For Stars: if available
      message: payment.currency === 'stars' 
        ? 'Stars payout initiated' 
        : 'Use TON wallet to receive payout',
    });
  } catch (error) {
    console.error('Claim winnings error:', error);
    res.status(500).json({ error: 'Failed to claim winnings' });
  }
});

export default router;

