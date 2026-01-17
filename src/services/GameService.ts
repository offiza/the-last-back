import { Match, Player, RoundResult, RoomPreset } from '../types/game';
import { ROOM_PRESETS } from '../constants/rooms.js';
import { calculateRoundScores, generateEndTime } from '../utils/gameLogic.js';

export class GameService {
  /**
   * Start a new round in a match
   */
  startRound(match: Match): Match {
    const preset = ROOM_PRESETS.find((p) => p.type === match.roomType);
    if (!preset) {
      throw new Error(`Room preset not found for type: ${match.roomType}`);
    }

    if (match.status !== 'playing') {
      throw new Error('Match is not in playing status');
    }

    const nextRound = match.currentRound + 1;
    if (nextRound > preset.rounds) {
      throw new Error('All rounds completed');
    }

    const roundStartTime = Date.now();
    const roundEndTime = generateEndTime(5, 15); // 5-15 seconds

    // Reset pressTime for all players
    match.players = match.players.map((player) => ({
      ...player,
      pressTime: undefined,
      position: undefined,
    }));

    match.currentRound = nextRound;
    match.roundStartTime = roundStartTime;
    match.roundEndTime = roundEndTime;

    return match;
  }

  /**
   * Record a button press for a player
   */
  recordPress(match: Match, playerId: string): Match {
    if (!match.roundStartTime || !match.roundEndTime) {
      throw new Error('Round not started');
    }

    const player = match.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error('Player not found in match');
    }

    // If player already pressed, ignore
    if (player.pressTime !== undefined) {
      return match;
    }

    const pressTime = Date.now() - match.roundStartTime;
    player.pressTime = pressTime;

    return match;
  }

  /**
   * End current round and calculate scores
   */
  endRound(match: Match): RoundResult {
    if (!match.roundStartTime || !match.roundEndTime) {
      throw new Error('Round not started');
    }

    const endTime = match.roundEndTime; // milliseconds from round start

    // Calculate scores for current round
    const roundPlayers = calculateRoundScores(match.players, endTime);

    // Update total player scores
    match.players = match.players.map((player) => {
      const roundPlayer = roundPlayers.find((p) => p.id === player.id);
      if (roundPlayer) {
        // Add round score to total score
        return {
          ...player,
          score: (player.score || 0) + (roundPlayer.score || 0),
          pressTime: roundPlayer.pressTime,
          position: roundPlayer.position,
        };
      }
      return player;
    });

    // Also update allPlayers to keep scores synchronized
    if (match.allPlayers) {
      match.allPlayers = match.allPlayers.map((player) => {
        const activePlayer = match.players.find((p) => p.id === player.id);
        if (activePlayer) {
          // Update with current score from active players
          return {
            ...player,
            score: activePlayer.score,
          };
        }
        // Keep original score for players who left
        return player;
      });
    }

    const roundResult: RoundResult = {
      roundNumber: match.currentRound,
      players: roundPlayers.map((p) => ({
        ...p,
        score: roundPlayers.find((rp) => rp.id === p.id)?.score || 0, // Score only for this round
      })),
      endTime,
    };

    match.roundResults.push(roundResult);

    // Clear round timing
    match.roundStartTime = undefined;
    match.roundEndTime = undefined;

    // Check if game is finished
    const preset = ROOM_PRESETS.find((p) => p.type === match.roomType);
    if (preset && match.currentRound >= preset.rounds) {
      match.status = 'finished';
      match.finishedAt = new Date();
    }

    return roundResult;
  }

  /**
   * Check if round should end (timeout)
   */
  shouldEndRound(match: Match): boolean {
    if (!match.roundStartTime || !match.roundEndTime) {
      return false;
    }

    const elapsed = Date.now() - match.roundStartTime;
    return elapsed >= match.roundEndTime;
  }
}

// Singleton instance
export const gameService = new GameService();

