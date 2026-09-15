'use client';

import { io, Socket } from 'socket.io-client';

// Same backend the REST API dev-proxy points at (see next.config.mjs). Socket.IO negotiates
// its own transport/path, so it connects directly rather than through the Next.js rewrite.
const SOCKET_URL = 'http://localhost:5102';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { autoConnect: true });
  }
  return socket;
}
