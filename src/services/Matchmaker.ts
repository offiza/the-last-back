import { Match, Player, RoomType, RoomPreset } from '../types/game';
import { ROOM_PRESETS } from '../constants/rooms.js';
import { prisma } from '../db/prisma.js';

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
  async findOrCreateMatch(roomType: RoomType, player: Player): Promise<Match> {
    const preset = ROOM_PRESETS.find((p) => p.type === roomType);
    if (!preset) {
      throw new Error(`Room preset not found for type: ${roomType}`);
    }

    // First, try to find in active matches
    const waitingMatches = Array.from(this.activeMatches.values()).filter(
      (activeMatch) =>
        activeMatch.match.roomType === roomType &&
        activeMatch.match.status === 'waiting' &&
        activeMatch.match.players.length > 0 &&
        activeMatch.match.players.length < preset.maxPlayers
    );

    // Use the first available waiting match from memory
    let waitingMatch: ActiveMatch | undefined = waitingMatches[0];

    // If not found in memory, try to restore from database
    if (!waitingMatch) {
      try {
        const dbMatch = await prisma.match.findFirst({
          where: {
            roomType,
            status: 'waiting',
          },
          include: {
            players: {
              where: {
                leftEarly: false,
                leftAt: null,
              },
              orderBy: {
                joinedAt: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        });

        if (dbMatch && dbMatch.players.length < preset.maxPlayers) {
          // Restore match from database
          const restoredMatch: Match = {
            id: dbMatch.id,
            roomType: dbMatch.roomType as RoomType,
            status: dbMatch.status as 'waiting' | 'playing' | 'finished',
            players: dbMatch.players.map(p => ({
              id: p.playerId,
              name: p.playerName,
              score: p.score,
            })),
            allPlayers: dbMatch.players.map(p => ({
              id: p.playerId,
              name: p.playerName,
              score: p.score,
            })),
            currentRound: dbMatch.currentRound,
            roundResults: [],
            createdAt: dbMatch.createdAt,
            startedAt: dbMatch.startedAt || undefined,
            finishedAt: dbMatch.finishedAt || undefined,
          };

          // Add to active matches
          this.activeMatches.set(dbMatch.id, {
            match: restoredMatch,
            sockets: new Set(),
          });

          // Restore playerToMatch mapping for restored players
          for (const player of restoredMatch.players) {
            this.playerToMatch.set(player.id, dbMatch.id);
          }

          console.log(`♻️ Restored match ${dbMatch.id} from database (${restoredMatch.players.length} players)`);
          const restoredActiveMatch = this.activeMatches.get(dbMatch.id);
          if (restoredActiveMatch) {
            waitingMatch = restoredActiveMatch;
          }
        }
      } catch (error) {
        console.error('Error restoring match from database:', error);
      }
    }

    if (waitingMatch && waitingMatch.match.players.length < preset.maxPlayers) {
      // Double-check that match still exists in activeMatches (race condition protection)
      // This prevents adding player to a match that was just deleted
      const matchId = waitingMatch.match.id;
      const stillActiveMatch = this.activeMatches.get(matchId);
      
      if (!stillActiveMatch) {
        console.log(`⚠️ Match ${matchId} was removed while processing join. Creating new match.`);
        waitingMatch = undefined; // Will create new match below
      } else {
        // Verify match is still in valid state
        if (stillActiveMatch.match.status !== 'waiting' || 
            stillActiveMatch.match.players.length >= preset.maxPlayers) {
          console.log(`⚠️ Match ${matchId} is no longer joinable (status: ${stillActiveMatch.match.status}, players: ${stillActiveMatch.match.players.length}). Creating new match.`);
          waitingMatch = undefined; // Will create new match below
        } else {
          // Use the still-active match from activeMatches (not the cached reference)
          waitingMatch = stillActiveMatch;
        }
      }
    }

    if (waitingMatch && waitingMatch.match.players.length < preset.maxPlayers) {
      // Check if player is already in this match (prevent duplicates)
      const playerAlreadyInMatch = waitingMatch.match.players.some(p => p.id === player.id);
      if (playerAlreadyInMatch) {
        console.log(`⚠️ Player ${player.id} is already in match ${waitingMatch.match.id}. Skipping duplicate join.`);
        // Update playerToMatch mapping in case it was missing
        this.playerToMatch.set(player.id, waitingMatch.match.id);
        return waitingMatch.match;
      }

      // Add player to existing match
      const playersBefore = waitingMatch.match.players.length;
      console.log(`🔗 Player ${player.id} joining existing match ${waitingMatch.match.id} (${playersBefore}/${preset.maxPlayers} players)`);
      waitingMatch.match.players.push(player);
      const playersAfter = waitingMatch.match.players.length;
      console.log(`👥 Match ${waitingMatch.match.id} now has ${playersAfter}/${preset.maxPlayers} players`);
      
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
    console.log(`🆕 Creating new match for player ${player.id} (roomType: ${roomType}). Available waiting matches: ${waitingMatches.length}`);

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
    if (!activeMatch) {
      console.warn(`⚠️ Cannot start match ${matchId}: not found in active matches`);
      return undefined;
    }

    const match = activeMatch.match;
    const preset = ROOM_PRESETS.find((p) => p.type === match.roomType);
    if (!preset) {
      console.warn(`⚠️ Cannot start match ${matchId}: preset not found for type ${match.roomType}`);
      return undefined;
    }

    if (match.status !== 'waiting') {
      console.warn(`⚠️ Cannot start match ${matchId}: status is ${match.status}, expected 'waiting'`);
      return undefined;
    }

    if (match.players.length < preset.maxPlayers) {
      console.warn(`⚠️ Cannot start match ${matchId}: only ${match.players.length}/${preset.maxPlayers} players`);
      return undefined;
    }

    if (match.players.length < 2) {
      console.error(`❌ Cannot start match ${matchId}: at least 2 players required, but only ${match.players.length} player(s)`);
      return undefined;
    }

    console.log(`🚀 Starting match ${matchId} with ${match.players.length} players`);
    match.status = 'playing';
    match.startedAt = new Date();

    return match;
  }

  /**
   * Remove player from match
   */
  async removePlayer(playerId: string): Promise<void> {
    const matchId = this.playerToMatch.get(playerId);
    if (!matchId) return;

    const activeMatch = this.activeMatches.get(matchId);
    if (!activeMatch) return;

    // Remove player from active players, but keep in allPlayers
    // This way we can still update stats for all participants
    activeMatch.match.players = activeMatch.match.players.filter(
      (p) => p.id !== playerId
    );

    // If match is empty, remove it and delete from database if waiting
    if (activeMatch.match.players.length === 0) {
      console.log(`🗑️ Removing empty match ${matchId} (status: ${activeMatch.match.status})`);
      this.activeMatches.delete(matchId);
      
      // Delete waiting matches from database to prevent orphaned records
      if (activeMatch.match.status === 'waiting') {
        // Fire and forget - don't block on database delete
        prisma.match.delete({
          where: { id: matchId },
        }).then(() => {
          console.log(`🗑️ Deleted empty waiting match ${matchId} from database`);
        }).catch((error) => {
          console.error(`❌ Error deleting empty match ${matchId} from database:`, error);
        });
      }
    } else {
      console.log(`👋 Player ${playerId} left match ${matchId}. Remaining players: ${activeMatch.match.players.length}`);
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

    const isReady = match.status === 'waiting' && match.players.length >= preset.maxPlayers;
    
    if (isReady) {
      console.log(`✅ Match ${matchId} is ready: ${match.players.length}/${preset.maxPlayers} players`);
    } else {
      console.log(`⏳ Match ${matchId} not ready: status=${match.status}, players=${match.players.length}/${preset.maxPlayers}`);
    }
    
    return isReady;
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

