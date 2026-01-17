import { Router } from 'express';
import roomsRouter from './rooms.js';
import leaderboardRouter from './leaderboard.js';
import paymentsRouter from './payments.js';

const router = Router();

// API routes
router.use('/rooms', roomsRouter);
router.use('/leaderboard', leaderboardRouter);
router.use('/payments', paymentsRouter);
// router.use('/match', matchRouter);

export default router;

