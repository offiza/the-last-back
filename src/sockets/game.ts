import { Server, Socket } from 'socket.io';
import { matchmaker } from '../services/Matchmaker.js';
import { gameService } from '../services/GameService.js';
import { playerStatsService } from '../services/PlayerStats.js';
import { paymentService } from '../services/PaymentService.js';
import { matchService } from '../services/MatchService.js';
import { determineWinners } from '../utils/gameLogic.js';

/**
 * Start a round (called by server when match starts or after previous round)
 */
export function startRoundForMatch(io: Server, matchId: string) {
  const match = matchmaker.getMatch(matchId);
  if (!match) {
    console.warn(`⚠️ Match ${matchId} not found when trying to start round`);
    return;
  }

  if (match.status !== 'playing') {
    console.warn(`⚠️ Match ${matchId} is not in playing status: ${match.status}`);
    return;
  }

  try {
    const updatedMatch = gameService.startRound(match);
    console.log(`✅ Round ${updatedMatch.currentRound} started for match ${matchId}, roundStartTime: ${updatedMatch.roundStartTime}, roundEndTime: ${updatedMatch.roundEndTime}`);
    
    // Notify all players in the match room
    io.to(matchId).emit('round:started', {
      match: updatedMatch,
      roundNumber: updatedMatch.currentRound,
      startTime: updatedMatch.roundStartTime,
      endTime: updatedMatch.roundEndTime, // milliseconds from start
    });

    console.log(`📢 Sent round:started event to all players in match ${matchId}`);

    // Schedule round end
    if (updatedMatch.roundEndTime) {
      setTimeout(async () => {
        await endRoundForMatch(io, matchId);
      }, updatedMatch.roundEndTime);
      console.log(`⏰ Scheduled round end in ${updatedMatch.roundEndTime}ms`);
    }
  } catch (error) {
    console.error('❌ Start round error:', error);
  }
}

/**
 * End a round (called automatically by timeout or manually)
 */
export async function endRoundForMatch(io: Server, matchId: string) {
  const match = matchmaker.getMatch(matchId);
  if (!match) {
    console.warn(`⚠️ Match ${matchId} not found when trying to end round`);
    return;
  }

  try {
    console.log(`🛑 Ending round ${match.currentRound} for match ${matchId}`);
    console.log(`📊 Players in match:`, match.players.map(p => ({ id: p.id, name: p.name, pressTime: p.pressTime, score: p.score })));
    
    const roundResult = gameService.endRound(match);
    
    console.log(`✅ Round ${roundResult.roundNumber} ended, result:`, roundResult);
    
    // Notify all players
    io.to(matchId).emit('round:ended', {
      match,
      roundResult,
    });

    console.log(`📢 Sent round:ended event to all players in match ${matchId}`);

    // If game finished, update player stats, process payments, and emit finished event
    if (match.status === 'finished' && !match.statsUpdated) {
      // Use allPlayers if available (includes players who left), otherwise use current players
      const playersToUpdate = match.allPlayers && match.allPlayers.length > 0 
        ? match.allPlayers 
        : match.players;
      
      // Determine winners based on final scores (server-side only)
      const winners = determineWinners(playersToUpdate);
      const winnerIds = new Set(winners.map((w) => w.id));

      // Update stats for all players who participated (only once)
      await Promise.all(
        playersToUpdate.map(async (player) => {
          const isWinner = winnerIds.has(player.id);
          await playerStatsService.updateStats(
            player.id,
            player.name,
            isWinner,
            player.score || 0
          );
        })
      );

      // Process payments for winners (only for paid rooms)
      if (match.roomType !== 'free') {
        try {
          const paymentData = await paymentService.processMatchCompletion(match);
          console.log(`💰 Payment data created for match ${matchId}:`, paymentData);
        } catch (error) {
          console.error(`❌ Error processing payments for match ${matchId}:`, error);
        }
      }

      // Mark stats as updated to prevent duplicate updates
      match.statsUpdated = true;

      // Save match to database
      try {
        await matchService.finishMatch(match, winners);
      } catch (error) {
        console.error('Error saving finished match to database:', error);
      }

      // Send match finished event with allPlayers and winners included
      // This ensures clients use server-determined winners, not client-side calculations
      io.to(matchId).emit('match:finished', {
        match: {
          ...match,
          // Ensure allPlayers is included in the event (includes players who left)
          allPlayers: playersToUpdate,
        },
        // Send winners determined on server (authoritative)
        winners: winners,
        allPlayers: playersToUpdate,
      });
    } else {
      // Start next round after 3 seconds
      setTimeout(() => {
        startRoundForMatch(io, matchId);
      }, 3000);
    }
  } catch (error) {
    console.error('End round error:', error);
  }
}

export function setupGameHandlers(io: Server, socket: Socket) {
  /**
   * Handle button press in a round
   */
  socket.on('round:press', () => {
    console.log(`📥 Received round:press from socket ${socket.id}`);
    try {
      const playerId = matchmaker.getPlayerBySocket(socket.id);
      console.log(`🔍 Player ID for socket ${socket.id}:`, playerId);
      
      if (!playerId) {
        console.error('❌ Player not found for socket:', socket.id);
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      const match = matchmaker.getMatchByPlayerId(playerId);
      console.log(`🔍 Match for player ${playerId}:`, match ? match.id : 'not found');
      
      if (!match) {
        console.error('❌ Match not found for player:', playerId);
        socket.emit('error', { message: 'Match not found' });
        return;
      }

      console.log(`🔍 Match status: ${match.status}, roundStartTime: ${match.roundStartTime}`);

      if (match.status !== 'playing') {
        console.error('❌ Match is not in playing status:', match.status);
        socket.emit('error', { message: 'Match is not in playing status' });
        return;
      }

      // Record press
      const updatedMatch = gameService.recordPress(match, playerId);
      console.log(`✅ Press recorded for player ${playerId} in match ${match.id}, pressTime: ${updatedMatch.players.find(p => p.id === playerId)?.pressTime}`);
      
      // Only notify the player who pressed (for optimistic UI update)
      // Other players should NOT know who pressed - this is private information
      socket.emit('round:playerPressed', {
        match: updatedMatch,
        playerId,
      });

      console.log(`✅ Notified player ${playerId} about their own press (private)`);
    } catch (error) {
      console.error('❌ Round press error:', error);
      socket.emit('error', { message: 'Failed to record press' });
    }
  });
}

