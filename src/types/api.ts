import { Match, Player, RoomPreset } from './game';

// API Request/Response types
export interface JoinRoomRequest {
  roomType: 'stars' | 'ton';
  userId: string;
  userName: string;
}

export interface JoinRoomResponse {
  matchId: string;
  match: Match;
}

export interface PressButtonRequest {
  matchId: string;
  playerId: string;
}

export interface PressButtonResponse {
  success: boolean;
  pressTime: number;
}

export interface GetRoomsResponse {
  rooms: RoomPreset[];
}

export interface MatchStatusResponse {
  match: Match;
}

// WebSocket event types
export type SocketEvent =
  | 'match:joined'
  | 'match:playerJoined'
  | 'match:started'
  | 'round:started'
  | 'round:ended'
  | 'match:finished'
  | 'error';

export interface SocketEventData {
  type: SocketEvent;
  payload: any;
}

