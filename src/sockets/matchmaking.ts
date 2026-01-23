import { Server, Socket } from 'socket.io';
import { matchmaker } from '../services/Matchmaker.js';
import { paymentService } from '../services/PaymentService.js';
import { matchService } from '../services/MatchService.js';
import { joinIntentService } from '../services/JoinIntentService.js';
import { Player, RoomType } from '../types/game';
import { parseTelegramUser, validateTelegramData } from '../utils/telegram.js';
import { ROOM_PRESETS } from '../constants/rooms.js';

interface JoinRoomData {
  roomType: RoomType;
  initData?: string; // Telegram WebApp initData
  userId?: string; // Fallback for development
  userName?: string; // Fallback for development
  paymentId?: string; // Payment ID for paid rooms
  paymentSignature?: string; // Payment signature for verification
}

export function setupMatchmakingHandlers(io: Server, socket: Socket) {
  /**
   * Subscribe to join intent status updates
   * Client can subscribe to specific intent or player events
   */
  socket.on('join-intent:subscribe', (data: { intentId?: string; playerId?: string }) => {
    try {
      const { intentId, playerId } = data;
      
      if (intentId) {
        socket.join(`intent:${intentId}`);
        console.log(`📡 Socket ${socket.id} subscribed to intent:${intentId}`);
      }
      
      if (playerId) {
        socket.join(`player:${playerId}`);
        console.log(`📡 Socket ${socket.id} subscribed to player:${playerId}`);
      }
      
      if (!intentId && !playerId) {
        socket.emit('error', { message: 'Must provide intentId or playerId' });
      }
    } catch (error) {
      console.error('Error subscribing to join intent:', error);
      socket.emit('error', { message: 'Failed to subscribe to join intent' });
    }
  });

  /**
   * Unsubscribe from join intent status updates
   */
  socket.on('join-intent:unsubscribe', (data: { intentId?: string; playerId?: string }) => {
    try {
      const { intentId, playerId } = data;
      
      if (intentId) {
        socket.leave(`intent:${intentId}`);
      }
      
      if (playerId) {
        socket.leave(`player:${playerId}`);
      }
    } catch (error) {
      console.error('Error unsubscribing from join intent:', error);
    }
  });

  /**
   * Join a room/match
   */
  socket.on('match:join', async (data: JoinRoomData) => {
    try {
      const { roomType, initData, userId, userName, paymentId, paymentSignature } = data;

      // Parse user from Telegram or use fallback
      let playerId: string;
      let playerName: string;

      if (initData) {
        // Validate Telegram initData if bot token is configured
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          const isValid = validateTelegramData(initData, botToken);
          if (!isValid) {
            socket.emit('error', { message: 'Invalid Telegram data signature' });
            return;
          }
        }

        const telegramUser = parseTelegramUser(initData);
        if (!telegramUser) {
          socket.emit('error', { message: 'Invalid Telegram data' });
          return;
        }
        playerId = telegramUser.id.toString();
        playerName = telegramUser.first_name || 'Player';
      } else {
        // Development fallback
        playerId = userId || socket.id;
        playerName = userName || 'Player';
      }

      // Check if player is already in a match
      const existingMatch = matchmaker.getMatchByPlayerId(playerId);
      if (existingMatch) {
        socket.emit('match:alreadyJoined', { match: existingMatch });
        return;
      }

      // For paid rooms, verify payment before joining
      let paidIntent: any = null; // Store TON intent for later
      let matchIdFromIntent: string | null = null; // For TON rooms, matchId comes from intent
      
      if (roomType !== 'free') {
        if (roomType === 'ton') {
          // For TON rooms, intent is created with roomId (matchId) immediately
          // Find PAID intent to get matchId
          const playerIntent = await prisma.joinIntent.findFirst({
            where: {
              playerId,
              roomType: 'ton',
              status: 'PAID',
            },
            orderBy: {
              paidAt: 'desc',
            },
          });

          if (!playerIntent || !playerIntent.roomId) {
            socket.emit('error', { 
              message: 'No paid deposit found. Please complete the deposit transaction first.' 
            });
            return;
          }

          matchIdFromIntent = playerIntent.roomId;
          paidIntent = await joinIntentService.getPaidIntentForJoin(playerId, matchIdFromIntent, 'ton');
          
          if (!paidIntent) {
            socket.emit('error', { 
              message: 'No paid deposit found. Please complete the deposit transaction first.' 
            });
            return;
          }

          console.log(`✅ Verified paid JoinIntent ${paidIntent.id} for player ${playerId}, matchId: ${matchIdFromIntent}`);
        } else if (roomType === 'stars') {
          // For Stars rooms, verify Telegram payment
          if (!paymentId || !paymentSignature) {
            socket.emit('error', { message: 'Payment required for paid rooms' });
            return;
          }

          // Verify payment
          const paymentVerified = await paymentService.verifyEntryPayment(
            paymentId,
            playerId,
            paymentSignature
          );

          if (!paymentVerified) {
            socket.emit('error', { message: 'Payment verification failed' });
            return;
          }
        }
      }

      // Create or find match
      const player: Player = {
        id: playerId,
        name: playerName,
        score: 0,
      };

      let match: any;
      
      if (roomType === 'ton' && matchIdFromIntent) {
        // For TON rooms, use matchId from intent
        // Try to get existing match from matchmaker
        match = matchmaker.getMatch(matchIdFromIntent);
        
        if (!match) {
          // Match might not be in memory, restore from DB
          match = await matchmaker.restoreMatchById(matchIdFromIntent);
          
          if (!match) {
            socket.emit('error', { 
              message: 'Match not found. The match may have expired. Please create a new intent.' 
            });
            return;
          }
        }

        // Add player to match if not already there
        const playerExists = match.players.some((p: Player) => p.id === playerId);
        if (!playerExists) {
          match.players.push(player);
          if (!match.allPlayers) {
            match.allPlayers = [...match.players];
          } else {
            const existsInAll = match.allPlayers.some((p: Player) => p.id === playerId);
            if (!existsInAll) {
              match.allPlayers.push(player);
            }
          }
        }
        
        // Ensure match is in matchmaker's activeMatches
        // Use matchmaker's methods to register
        matchmaker.addSocketToMatch(match.id, socket.id, playerId);
      } else {
        // For free/Stars rooms, create or find match normally
        match = await matchmaker.findOrCreateMatch(roomType, player);
        matchmaker.addSocketToMatch(match.id, socket.id, playerId);
      }
      matchmaker.addSocketToMatch(match.id, socket.id, playerId);

      // Save match to database
      try {
        await matchService.saveMatch(match);
      } catch (error) {
        console.error('Failed to save match to database:', error);
        // Continue anyway, match can work without DB
      }

      // Link payment to match if Stars room
      // For TON rooms, intent is already linked via roomId when created
      if (roomType !== 'free' && roomType === 'stars' && paymentId) {
        try {
          await paymentService.linkPaymentToMatch(paymentId, match.id);
        } catch (error) {
          console.error('Failed to link payment to match:', error);
          // Continue anyway, payment is already verified
        }
      }

      // Join socket room for this match
      socket.join(match.id);
      
      // Also join player room for receiving join-intent events
      socket.join(`player:${playerId}`);

      // Check if match is ready to start BEFORE notifying players
      // This ensures all players get the correct status
      let matchToNotify = match;
      let matchJustStarted = false;
      
      if (matchmaker.isMatchReady(match.id)) {
        const startedMatch = matchmaker.startMatch(match.id);
        if (startedMatch) {
          matchToNotify = startedMatch;
          matchJustStarted = true;
          
          // Save match with 'playing' status to database
          try {
            await matchService.saveMatch(startedMatch);
            console.log(`✅ Saved match ${startedMatch.id} to database with status: ${startedMatch.status}`);
          } catch (error) {
            console.error('Failed to save started match to database:', error);
          }
        }
      }

      // Notify player with current match state (may be already started)
      socket.emit('match:joined', {
        match: matchToNotify,
        playerId,
      });

      // Notify other players in the match with updated state
      socket.to(match.id).emit('match:playerJoined', {
        match: matchToNotify,
        newPlayer: player,
      });

      // If match just started, notify all players and start round
      if (matchJustStarted) {
        // Match just started, notify all players
        io.to(match.id).emit('match:started', { match: matchToNotify });
        
        // Start first round after 2 seconds
        setTimeout(() => {
          import('./game.js').then(({ startRoundForMatch }) => {
            startRoundForMatch(io, match.id);
          });
        }, 2000);
      } else if (matchToNotify.status === 'playing') {
        // Match is already playing, check if round has started
        if (matchToNotify.roundStartTime) {
          // Round is already in progress, send round:started to new player
          socket.emit('round:started', {
            match: matchToNotify,
            roundNumber: matchToNotify.currentRound,
            startTime: matchToNotify.roundStartTime,
            endTime: matchToNotify.roundEndTime,
          });
          console.log(`Sent round:started to new player ${playerId} for ongoing round ${matchToNotify.currentRound}`);
        } else {
          // Match is playing but round hasn't started yet, wait for it
          console.log(`Match ${match.id} is playing but round not started yet for player ${playerId}`);
        }
      }

      console.log(`Player ${playerName} (${playerId}) joined match ${match.id}`);
    } catch (error) {
      console.error('Match join error:', error);
      socket.emit('error', { message: 'Failed to join match' });
    }
  });

  /**
   * Leave match
   */
  socket.on('match:leave', async () => {
    try {
      const playerId = matchmaker.getPlayerBySocket(socket.id);
      if (!playerId) {
        socket.emit('error', { message: 'Player not found in any match' });
        return;
      }

      const match = matchmaker.getMatchByPlayerId(playerId);
      if (!match) {
        socket.emit('error', { message: 'Match not found' });
        return;
      }

      // Create refund for TON rooms if match hasn't started yet
      if (match.roomType === 'ton' && match.status === 'waiting') {
        try {
          const refundId = await joinIntentService.createRefundForPlayer(playerId, match.id, 'player_left');
          if (refundId) {
            console.log(`💰 Refund ${refundId} created for player ${playerId} leaving TON match ${match.id}`);
            // TODO: Send refund transaction via blockchain worker
            // For now, refund record is created and status is CREATED
            // Actual transaction will be sent by a worker/service later
          }
        } catch (error) {
          console.error(`❌ Failed to create refund for player ${playerId}:`, error);
          // Don't block leaving match - refund can be handled later
        }
      }

      matchmaker.removePlayer(playerId).catch(err => console.error('Error removing player:', err));
      matchmaker.removeSocketFromMatch(match.id, socket.id);
      socket.leave(match.id);

      // Notify other players
      const updatedMatch = matchmaker.getMatch(match.id);
      if (updatedMatch) {
        socket.to(match.id).emit('match:playerLeft', {
          match: updatedMatch,
          playerId,
        });
      }

      socket.emit('match:left', { matchId: match.id });
    } catch (error) {
      console.error('Match leave error:', error);
      socket.emit('error', { message: 'Failed to leave match' });
    }
  });

  /**
   * Get match status
   */
  socket.on('match:status', (data: { matchId: string }) => {
    try {
      const match = matchmaker.getMatch(data.matchId);
      if (match) {
        socket.emit('match:status', { match });
      } else {
        socket.emit('error', { message: 'Match not found' });
      }
    } catch (error) {
      console.error('Match status error:', error);
      socket.emit('error', { message: 'Failed to get match status' });
    }
  });

  /**
   * Handle disconnect
   */
  socket.on('disconnect', async () => {
    try {
      const playerId = matchmaker.getPlayerBySocket(socket.id);
      if (playerId) {
        const match = matchmaker.getMatchByPlayerId(playerId);
        if (match) {
          // Create refund for TON rooms if match hasn't started yet
          if (match.roomType === 'ton' && match.status === 'waiting') {
            try {
              const refundId = await joinIntentService.createRefundForPlayer(playerId, match.id, 'player_left');
              if (refundId) {
                console.log(`💰 Refund ${refundId} created for player ${playerId} disconnecting from TON match ${match.id}`);
                // TODO: Send refund transaction via blockchain worker
              }
            } catch (error) {
              console.error(`❌ Failed to create refund for disconnected player ${playerId}:`, error);
              // Don't block disconnect - refund can be handled later
            }
          }

          // Remove player from match
          matchmaker.removePlayer(playerId).catch(err => console.error('Error removing player:', err));
          matchmaker.removeSocketFromMatch(match.id, socket.id);

          // Notify other players
          const updatedMatch = matchmaker.getMatch(match.id);
          if (updatedMatch) {
            socket.to(match.id).emit('match:playerLeft', {
              match: updatedMatch,
              playerId,
            });
          }

          console.log(`Player ${playerId} disconnected from match ${match.id}`);
        }
      }
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });
}

