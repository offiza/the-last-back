import { RoomPreset } from '../types/game';

// Get max players from environment variables, with defaults
// Can be set per room type: MAX_PLAYERS_FREE, MAX_PLAYERS_STARS, MAX_PLAYERS_TON
// Or use MAX_PLAYERS for all rooms
const getMaxPlayers = (roomType: 'free' | 'stars' | 'ton'): number => {
  // Check for room-specific env var first
  const roomEnvVar = `MAX_PLAYERS_${roomType.toUpperCase()}` as 'MAX_PLAYERS_FREE' | 'MAX_PLAYERS_STARS' | 'MAX_PLAYERS_TON';
  const roomSpecific = process.env[roomEnvVar];
  if (roomSpecific) {
    return parseInt(roomSpecific, 10);
  }

  // Fallback to general MAX_PLAYERS
  const general = process.env.MAX_PLAYERS;
  if (general) {
    return parseInt(general, 10);
  }

  // Default: 2 players for all rooms
  return 2;
};

// Keep constants in sync with shared/constants/rooms.ts
export const ROOM_PRESETS: RoomPreset[] = [
  {
    id: 'free_0',
    type: 'free',
    entryFee: 0,
    maxPlayers: getMaxPlayers('free'),
    rounds: 3,
    platformFee: 0, // No platform fee for free room
  },
  {
    id: 'stars_25',
    type: 'stars',
    entryFee: 25,
    maxPlayers: getMaxPlayers('stars'),
    rounds: 3,
    platformFee: 10,
  },
  {
    id: 'ton_0_1',
    type: 'ton',
    entryFee: 0.1,
    maxPlayers: getMaxPlayers('ton'),
    rounds: 3,
    platformFee: 10,
  },
];

