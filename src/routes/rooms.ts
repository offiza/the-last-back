import { Router } from 'express';
import { matchmaker } from '../services/Matchmaker.js';

const router = Router();

/**
 * GET /api/rooms
 * Get list of available room presets
 */
router.get('/', (req, res) => {
  try {
    const rooms = matchmaker.getRoomPresets();
    res.json({ rooms });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Failed to get rooms' });
  }
});

export default router;

