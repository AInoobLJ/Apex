import websocket from '@fastify/websocket';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import { logger } from '../lib/logger';
const clients = new Set<any>();

async function websocketPlugin(fastify: FastifyInstance) {
  await fastify.register(websocket);

  fastify.get('/ws', { websocket: true }, (socket, request) => {
    // Auth via query param
    const url = new URL(request.url, `http://${request.headers.host}`);
    const apiKey = url.searchParams.get('apiKey');

    if (apiKey !== config.API_KEY) {
      socket.close(4001, 'Unauthorized');
      return;
    }

    clients.add(socket);
    logger.info({ clientCount: clients.size }, 'WebSocket client connected');

    socket.on('close', () => {
      clients.delete(socket);
      logger.info({ clientCount: clients.size }, 'WebSocket client disconnected');
    });

    socket.on('error', () => {
      clients.delete(socket);
    });
  });
}

/**
 * Broadcast an event to all connected WebSocket clients.
 */
export function broadcast(event: string, data: unknown): void {
  const message = JSON.stringify({ event, data });
  for (const client of clients) {
    try {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    } catch {
      clients.delete(client);
    }
  }
}

export default fp(websocketPlugin, { name: 'websocket' });
