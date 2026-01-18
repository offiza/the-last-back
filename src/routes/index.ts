import { Router } from 'express';
import roomsRouter from './rooms.js';
import leaderboardRouter from './leaderboard.js';
import paymentsRouter from './payments.js';
import walletRouter from './wallet.js';
import joinIntentRouter from './joinIntent.js';

const router = Router();

// API routes
router.use('/rooms', roomsRouter);
router.use('/leaderboard', leaderboardRouter);
router.use('/payments', paymentsRouter);
router.use('/wallet', walletRouter);
router.use('/', joinIntentRouter); // Join intent routes are at root level (e.g., /api/rooms/ton/join-intent)
// router.use('/match', matchRouter);

export default router;

