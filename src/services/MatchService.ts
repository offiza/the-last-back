import { Match, Player } from '../types/game';
import { prisma } from '../db/prisma.js';
import { matchIdToRoomId, roomIdToString } from '../utils/roomId.js';

/**
 * Service for managing matches in the database
 */
export class MatchService {
  /**
   * Save or update a match in the database
   * Computes and saves roomId (on-chain room ID) from matchId
   */
  async saveMatch(match: Match): Promise<void> {
    try {
      // Compute on-chain roomId from matchId (always recompute for consistency)
      const onChainRoomId = matchIdToRoomId(match.id);
      const onChainRoomIdStr = roomIdToString(onChainRoomId);

      const matchData = {
        id: match.id,
        roomId: onChainRoomIdStr, // On-chain room ID (uint64 as decimal string, always computed from matchId)
        roomType: match.roomType,
        status: match.status,
        currentRound: match.currentRound,
        rounds: match.allPlayers?.length || match.players.length, // Use as rounds count placeholder
        startedAt: match.startedAt,
        finishedAt: match.finishedAt,
      };

      const result = await prisma.match.upsert({
        where: { id: match.id },
        update: matchData,
        create: matchData,
      });
      
      console.log(`💾 Match ${match.id} saved to database: ${result.status}, roomId: ${onChainRoomIdStr} (${match.players.length} players)`);

      // Save/update players
      const playersToSave = match.allPlayers && match.allPlayers.length > 0 
        ? match.allPlayers 
        : match.players;

      for (const player of playersToSave) {
        // Check if player already exists in this match
        const existing = await prisma.matchPlayer.findFirst({
          where: {
            matchId: match.id,
            playerId: player.id,
          },
        });

        if (existing) {
          await prisma.matchPlayer.update({
            where: { id: existing.id },
            data: {
              playerName: player.name,
              score: player.score || 0,
            },
          });
        } else {
          await prisma.matchPlayer.create({
            data: {
              matchId: match.id,
              playerId: player.id,
              playerName: player.name,
              score: player.score || 0,
              isWinner: false,
              leftEarly: false,
            },
          });
        }
      }
    } catch (error) {
      console.error(`❌ Error saving match ${match.id} to database:`, error);
      // Don't throw - match can continue without DB save
    }
  }

  /**
   * Update match status and winners when match finishes
   */
  async finishMatch(match: Match, winners: Player[]): Promise<void> {
    try {
      // Update match status
      const updated = await prisma.match.update({
        where: { id: match.id },
        data: {
          status: 'finished',
          finishedAt: match.finishedAt || new Date(),
        },
      });
      
      console.log(`🏁 Match ${match.id} finished in database. Winners: ${winners.length}`);

      // Update winners
      const winnerIds = new Set(winners.map((w) => w.id));
      const playersToUpdate = match.allPlayers && match.allPlayers.length > 0 
        ? match.allPlayers 
        : match.players;

      for (const player of playersToUpdate) {
        const matchPlayer = await prisma.matchPlayer.findFirst({
          where: {
            matchId: match.id,
            playerId: player.id,
          },
        });

        if (matchPlayer) {
          await prisma.matchPlayer.update({
            where: { id: matchPlayer.id },
            data: {
              score: player.score || 0,
              isWinner: winnerIds.has(player.id),
              leftEarly: !match.players.some((p) => p.id === player.id), // Player left if not in current players
              leftAt: !match.players.some((p) => p.id === player.id) ? new Date() : undefined,
            },
          });
        }
      }
    } catch (error) {
      console.error(`❌ Error finishing match ${match.id} in database:`, error);
      // Don't throw - match can continue without DB save
    }
  }
}

// Singleton instance
export const matchService = new MatchService();

