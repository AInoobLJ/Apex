import { randomBytes } from 'crypto';
import websocket from '@fastify/websocket';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import { logger } from '../lib/logger';

const clients = new Set<any>();

// Ticket store: ticket → { expiresAt }. Tickets are single-use, 60-second TTL.
const wsTickets = new Map<string, { expiresAt: number }>();

// Cleanup expired tickets every 60s
setInterval(() => {
  const now = Date.now();
  for (const [ticket, meta] of wsTickets) {
    if (meta.expiresAt < now) wsTickets.delete(ticket);
  }
}, 60000);

async function websocketPlugin(fastify: FastifyInstance) {
  await fastify.register(websocket);

  // POST /api/v1/auth/ws-ticket — exchange API key for a 60-second WebSocket ticket
  fastify.post('/api/v1/auth/ws-ticket', async (request, reply) => {
    const apiKey = request.headers['x-api-key'] as string;
    if (apiKey !== config.API_KEY) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const ticket = randomBytes(32).toString('hex');
    wsTickets.set(ticket, { expiresAt: Date.now() + 60000 });
    return { ticket };
  });

  // WebSocket connection: auth via ticket (not raw API key)
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const ticket = url.searchParams.get('ticket');

    // Also support legacy apiKey param for backward compat (will be removed)
    const apiKey = url.searchParams.get('apiKey');

    let authenticated = false;
    if (ticket && wsTickets.has(ticket)) {
      const meta = wsTickets.get(ticket)!;
      wsTickets.delete(ticket); // Single-use
      if (meta.expiresAt > Date.now()) {
        authenticated = true;
      }
    } else if (apiKey === config.API_KEY) {
      // Legacy fallback — log deprecation warning
      logger.warn('WebSocket connected with legacy apiKey query param — migrate to ticket auth');
      authenticated = true;
    }

    if (!authenticated) {
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
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'WebSocket send failed, removing client');
      clients.delete(client);
    }
  }
}

export default fp(websocketPlugin, { name: 'websocket' });
