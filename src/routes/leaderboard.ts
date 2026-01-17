import { Router } from 'express';
import { playerStatsService } from '../services/PlayerStats.js';

const router = Router();

/**
 * GET /api/leaderboard
 * Get leaderboard
 * Query params:
 * - type: 'wins' | 'score' | 'winrate' (default: 'wins')
 * - limit: number (default: 100)
 */
router.get('/', async (req, res) => {
  try {
    const type = (req.query.type as string) || 'wins';
    const limit = parseInt(req.query.limit as string) || 100;

    let leaderboard;
    switch (type) {
      case 'score':
        leaderboard = await playerStatsService.getLeaderboardByScore(limit);
        break;
      case 'winrate':
        leaderboard = await playerStatsService.getLeaderboardByWinRate(limit);
        break;
      case 'wins':
      default:
        leaderboard = await playerStatsService.getLeaderboard(limit);
        break;
    }

    res.json({ leaderboard, type, limit });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

/**
 * GET /api/leaderboard/:playerId
 * Get player stats
 */
router.get('/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const stats = await playerStatsService.getPlayerStats(playerId);

    if (!stats) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json({ stats });
  } catch (error) {
    console.error('Get player stats error:', error);
    res.status(500).json({ error: 'Failed to get player stats' });
  }
});

export default router;

