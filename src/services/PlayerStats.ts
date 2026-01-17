import { Player } from '../types/game';
import { prisma } from '../db/prisma.js';

export interface PlayerStats {
  playerId: string;
  playerName: string;
  totalGames: number;
  totalWins: number;
  totalScore: number;
  bestScore: number;
  lastPlayed?: Date;
}

export class PlayerStatsService {
  /**
   * Update player stats after game completion
   */
  async updateStats(
    playerId: string,
    playerName: string,
    isWinner: boolean,
    finalScore: number
  ): Promise<void> {
    try {
      await prisma.playerStats.upsert({
        where: { playerId },
        update: {
          playerName,
          totalGames: { increment: 1 },
          totalWins: isWinner ? { increment: 1 } : undefined,
          totalScore: { increment: finalScore },
          bestScore: { set: Math.max(0, finalScore) }, // Will be updated correctly below
          lastPlayed: new Date(),
        },
        create: {
          playerId,
          playerName,
          totalGames: 1,
          totalWins: isWinner ? 1 : 0,
          totalScore: finalScore,
          bestScore: finalScore,
          lastPlayed: new Date(),
        },
      });

      // Update bestScore correctly (need to get current value first)
      const current = await prisma.playerStats.findUnique({
        where: { playerId },
        select: { bestScore: true },
      });

      if (current && finalScore > current.bestScore) {
        await prisma.playerStats.update({
          where: { playerId },
          data: { bestScore: finalScore },
        });
      }
    } catch (error) {
      console.error('Error updating player stats:', error);
      throw error;
    }
  }

  /**
   * Get player stats
   */
  async getPlayerStats(playerId: string): Promise<PlayerStats | null> {
    try {
      const stats = await prisma.playerStats.findUnique({
        where: { playerId },
      });

      if (!stats) {
        return null;
      }

      return {
        playerId: stats.playerId,
        playerName: stats.playerName,
        totalGames: stats.totalGames,
        totalWins: stats.totalWins,
        totalScore: stats.totalScore,
        bestScore: stats.bestScore,
        lastPlayed: stats.lastPlayed || undefined,
      };
    } catch (error) {
      console.error('Error getting player stats:', error);
      return null;
    }
  }

  /**
   * Get leaderboard (by wins, then best score)
   */
  async getLeaderboard(limit: number = 100): Promise<PlayerStats[]> {
    try {
      const stats = await prisma.playerStats.findMany({
        orderBy: [
          { totalWins: 'desc' },
          { bestScore: 'desc' },
        ],
        take: limit,
      });

      return stats.map((stat: any) => ({
        playerId: stat.playerId,
        playerName: stat.playerName,
        totalGames: stat.totalGames,
        totalWins: stat.totalWins,
        totalScore: stat.totalScore,
        bestScore: stat.bestScore,
        lastPlayed: stat.lastPlayed || undefined,
      }));
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      return [];
    }
  }

  /**
   * Get leaderboard by total score
   */
  async getLeaderboardByScore(limit: number = 100): Promise<PlayerStats[]> {
    try {
      const stats = await prisma.playerStats.findMany({
        orderBy: { totalScore: 'desc' },
        take: limit,
      });

      return stats.map((stat: any) => ({
        playerId: stat.playerId,
        playerName: stat.playerName,
        totalGames: stat.totalGames,
        totalWins: stat.totalWins,
        totalScore: stat.totalScore,
        bestScore: stat.bestScore,
        lastPlayed: stat.lastPlayed || undefined,
      }));
    } catch (error) {
      console.error('Error getting leaderboard by score:', error);
      return [];
    }
  }

  /**
   * Get leaderboard by win rate
   */
  async getLeaderboardByWinRate(limit: number = 100): Promise<PlayerStats[]> {
    try {
      // Get all players with at least 3 games
      const allStats = await prisma.playerStats.findMany({
        where: {
          totalGames: { gte: 3 },
        },
      });

      // Calculate win rate and sort
      const statsWithRate = allStats
        .map((stat: any) => ({
          playerId: stat.playerId,
          playerName: stat.playerName,
          totalGames: stat.totalGames,
          totalWins: stat.totalWins,
          totalScore: stat.totalScore,
          bestScore: stat.bestScore,
          lastPlayed: stat.lastPlayed || undefined,
          winRate: stat.totalWins / stat.totalGames,
        }))
        .sort((a: any, b: any) => b.winRate - a.winRate)
        .slice(0, limit)
        .map(({ winRate, ...rest }: any) => rest); // Remove winRate from result

      return statsWithRate;
    } catch (error) {
      console.error('Error getting leaderboard by win rate:', error);
      return [];
    }
  }
}

// Singleton instance
export const playerStatsService = new PlayerStatsService();

