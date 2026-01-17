import { Match, Player, RoomType, RoomPreset } from '../types/game';
import { ROOM_PRESETS } from '../constants/rooms.js';

interface ActiveMatch {
  match: Match;
  sockets: Set<string>; // Socket IDs of connected players
}

export class Matchmaker {
  private activeMatches: Map<string, ActiveMatch> = new Map();
  private playerToMatch: Map<string, string> = new Map(); // playerId -> matchId
  private socketToPlayer: Map<string, string> = new Map(); // socketId -> playerId

  /**
   * Find or create a match for a player
   */
  findOrCreateMatch(roomType: RoomType, player: Player): Match {
    const preset = ROOM_PRESETS.find((p) => p.type === roomType);
    if (!preset) {
      throw new Error(`Room preset not found for type: ${roomType}`);
    }

    // Find existing waiting match for this room type
    const waitingMatch = Array.from(this.activeMatches.values()).find(
      (activeMatch) =>
        activeMatch.match.roomType === roomType &&
        activeMatch.match.status === 'waiting' &&
        activeMatch.match.players.length < preset.maxPlayers
    );

    if (waitingMatch && waitingMatch.match.players.length < preset.maxPlayers) {
      // Add player to existing match
      waitingMatch.match.players.push(player);
      // Also add to allPlayers if not already there
      if (!waitingMatch.match.allPlayers) {
        waitingMatch.match.allPlayers = [...waitingMatch.match.players];
      } else {
        const exists = waitingMatch.match.allPlayers.some(p => p.id === player.id);
        if (!exists) {
          waitingMatch.match.allPlayers.push(player);
        }
      }
      this.playerToMatch.set(player.id, waitingMatch.match.id);
      return waitingMatch.match;
    }

    // Create new match

    const match: Match = {
      id: this.generateMatchId(),
      roomType,
      status: 'waiting',
      players: [player],
      allPlayers: [player], // Track all players who joined
      currentRound: 0,
      roundResults: [],
      createdAt: new Date(),
      statsUpdated: false,
    };

    this.activeMatches.set(match.id, {
      match,
      sockets: new Set(),
    });

    this.playerToMatch.set(player.id, match.id);

    return match;
  }

  /**
   * Get match by ID
   */
  getMatch(matchId: string): Match | undefined {
    return this.activeMatches.get(matchId)?.match;
  }

  /**
   * Get match by player ID
   */
  getMatchByPlayerId(playerId: string): Match | undefined {
    const matchId = this.playerToMatch.get(playerId);
    if (!matchId) return undefined;
    return this.getMatch(matchId);
  }

  /**
   * Add socket to match
   */
  addSocketToMatch(matchId: string, socketId: string, playerId: string): void {
    const activeMatch = this.activeMatches.get(matchId);
    if (activeMatch) {
      activeMatch.sockets.add(socketId);
      this.socketToPlayer.set(socketId, playerId);
    }
  }

  /**
   * Remove socket from match
   */
  removeSocketFromMatch(matchId: string, socketId: string): void {
    const activeMatch = this.activeMatches.get(matchId);
    if (activeMatch) {
      activeMatch.sockets.delete(socketId);
      this.socketToPlayer.delete(socketId);
    }
  }

  /**
   * Get player ID by socket ID
   */
  getPlayerBySocket(socketId: string): string | undefined {
    return this.socketToPlayer.get(socketId);
  }

  /**
   * Get all socket IDs for a match
   */
  getMatchSockets(matchId: string): string[] {
    const activeMatch = this.activeMatches.get(matchId);
    return activeMatch ? Array.from(activeMatch.sockets) : [];
  }

  /**
   * Start match (when full)
   */
  startMatch(matchId: string): Match | undefined {
    const activeMatch = this.activeMatches.get(matchId);
    if (!activeMatch) return undefined;

    const match = activeMatch.match;
    const preset = ROOM_PRESETS.find((p) => p.type === match.roomType);
    if (!preset) return undefined;

    if (match.status !== 'waiting' || match.players.length < preset.maxPlayers) {
      return undefined;
    }

    match.status = 'playing';
    match.startedAt = new Date();

    return match;
  }

  /**
   * Remove player from match
   */
  removePlayer(playerId: string): void {
    const matchId = this.playerToMatch.get(playerId);
    if (!matchId) return;

    const activeMatch = this.activeMatches.get(matchId);
    if (!activeMatch) return;

    // Remove player from active players, but keep in allPlayers
    // This way we can still update stats for all participants
    activeMatch.match.players = activeMatch.match.players.filter(
      (p) => p.id !== playerId
    );

    // If match is empty, remove it
    if (activeMatch.match.players.length === 0) {
      this.activeMatches.delete(matchId);
    }

    this.playerToMatch.delete(playerId);
  }

  /**
   * Check if match is ready to start
   */
  isMatchReady(matchId: string): boolean {
    const match = this.getMatch(matchId);
    if (!match) return false;

    const preset = ROOM_PRESETS.find((p) => p.type === match.roomType);
    if (!preset) return false;

    return match.status === 'waiting' && match.players.length >= preset.maxPlayers;
  }

  /**
   * Get room presets
   */
  getRoomPresets(): RoomPreset[] {
    return ROOM_PRESETS;
  }

  /**
   * Generate unique match ID
   */
  private generateMatchId(): string {
    return `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const matchmaker = new Matchmaker();

