import { Player, RoundResult } from '../types/game';

/**
 * Calculate scores for players in a round
 * @param players - array of players with their pressTime
 * @param endTime - round end time in milliseconds from round start
 * @returns array of players with assigned scores and positions
 */
export function calculateRoundScores(
  players: Player[],
  endTime: number
): Player[] {
  // Filter players who pressed before round end
  const validPlayers = players
    .filter((player) => {
      if (!player.pressTime) return false;
      return player.pressTime <= endTime;
    })
    .map((player) => ({
      ...player,
      delta: endTime - (player.pressTime || 0), // distance to end
    }));

  // Sort by delta (smaller = closer to end)
  validPlayers.sort((a, b) => a.delta - b.delta);

  // Assign scores
  const scoredPlayers = validPlayers.map((player, index) => {
    const position = index + 1;
    const score = Math.max(1, 10 - position);
    return {
      ...player,
      score,
      position,
    };
  });

  // Players who didn't press or pressed too late - get 0
  const invalidPlayers = players
    .filter((player) => {
      if (!player.pressTime) return true;
      return player.pressTime > endTime;
    })
    .map((player) => ({
      ...player,
      score: 0,
      position: undefined,
    }));

  // Combine and return all players
  const allPlayers = [...scoredPlayers, ...invalidPlayers];

  return allPlayers.map((player) => {
    const existingPlayer = players.find((p) => p.id === player.id);
    if (existingPlayer) {
      return {
        ...existingPlayer,
        score: player.score, // Score only for this round
        position: player.position,
        pressTime: player.pressTime,
      };
    }
    return player;
  });
}

/**
 * Generate random round end time
 * @param minSeconds - minimum time in seconds
 * @param maxSeconds - maximum time in seconds
 * @returns round end time in milliseconds
 */
export function generateEndTime(minSeconds: number = 5, maxSeconds: number = 15): number {
  const randomSeconds = Math.random() * (maxSeconds - minSeconds) + minSeconds;
  return Math.floor(randomSeconds * 1000);
}

/**
 * Determine game winners
 * @param players - array of players with final scores
 * @returns array of winners (can be multiple)
 */
export function determineWinners(players: Player[]): Player[] {
  if (players.length === 0) return [];

  const maxScore = Math.max(...players.map((p) => p.score || 0));
  return players.filter((p) => (p.score || 0) === maxScore);
}

/**
 * Calculate payout for winners
 * @param totalBank - total bank (entryFee * number of players)
 * @param platformFee - platform fee in percent
 * @param winnersCount - number of winners
 * @returns payout per winner
 */
export function calculatePayout(
  totalBank: number,
  platformFee: number,
  winnersCount: number
): number {
  const payout = totalBank * (1 - platformFee / 100);
  return payout / winnersCount;
}

