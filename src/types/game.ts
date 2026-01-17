export type RoomType = 'stars' | 'ton' | 'free';

export interface Room {
  id: string;
  type: RoomType;
  entryFee: number;
  maxPlayers: number;
  currentPlayers: number;
  rounds: number;
  platformFee: number; // in percent (e.g., 10)
}

export interface Player {
  id: string;
  name: string;
  avatar?: string;
  score: number;
  pressTime?: number; // press time in milliseconds from round start
  position?: number; // position in current round
}

export interface RoundResult {
  roundNumber: number;
  players: Player[];
  endTime: number; // round end time in milliseconds
}

export interface GameState {
  matchId?: string; // Match ID for backend operations (payments, etc.)
  room: Room;
  players: Player[];
  currentRound: number;
  roundResults: RoundResult[];
  gameStatus: 'waiting' | 'playing' | 'roundResult' | 'finished';
  roundStartTime?: number; // current round start time
  roundEndTime?: number; // hidden round end time
}

export interface GameResult {
  winners: Player[];
  totalBank: number;
  payout: number;
  allPlayers: Player[];
}

// Match-related types for backend
export interface Match {
  id: string;
  roomType: RoomType;
  status: 'waiting' | 'playing' | 'finished';
  players: Player[]; // Current active players
  allPlayers?: Player[]; // All players who participated (including those who left)
  currentRound: number;
  roundResults: RoundResult[];
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  roundStartTime?: number; // current round start time (timestamp)
  roundEndTime?: number; // current round end time (milliseconds from round start)
  statsUpdated?: boolean; // Flag to prevent duplicate stats updates
}

export interface RoomPreset {
  id: string;
  type: RoomType;
  entryFee: number;
  maxPlayers: number;
  rounds: number;
  platformFee: number;
}

