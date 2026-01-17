import { Server, Socket } from 'socket.io';
import { setupMatchmakingHandlers } from './matchmaking.js';
import { setupGameHandlers } from './game.js';

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id);

    // Setup matchmaking handlers
    setupMatchmakingHandlers(io, socket);

    // Setup game handlers
    setupGameHandlers(io, socket);
  });
}

