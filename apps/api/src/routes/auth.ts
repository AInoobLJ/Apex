/**
 * Auth routes — WebSocket ticket-based authentication.
 *
 * POST /auth/ws-ticket: exchanges API key for a 60-second WebSocket token.
 * The WebSocket server validates the token instead of accepting raw API keys.
 */
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

// In-memory ticket store — tickets expire after 60 seconds
const wsTickets = new Map<string, { apiKey: string; createdAt: number }>();

// Cleanup expired tickets every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ticket, data] of wsTickets) {
    if (now - data.createdAt > 60000) {
      wsTickets.delete(ticket);
    }
  }
}, 30000);

/**
 * Validate a WebSocket ticket. Returns the API key if valid, null if expired/invalid.
 * Tickets are single-use — consumed on validation.
 */
export function validateWsTicket(ticket: string): string | null {
  const data = wsTickets.get(ticket);
  if (!data) return null;

  // Check expiry (60 seconds)
  if (Date.now() - data.createdAt > 60000) {
    wsTickets.delete(ticket);
    return null;
  }

  // Single use — delete after validation
  wsTickets.delete(ticket);
  return data.apiKey;
}

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/ws-ticket — exchange API key for a 60-second WebSocket token
  fastify.post('/auth/ws-ticket', async (request, reply) => {
    const apiKey = request.headers['x-api-key'] as string;
    if (!apiKey) {
      return reply.status(401).send({ error: 'API key required' });
    }

    // Generate a random ticket
    const ticket = crypto.randomBytes(32).toString('hex');
    wsTickets.set(ticket, { apiKey, createdAt: Date.now() });

    return {
      ticket,
      expiresIn: 60,
      wsUrl: `ws://${request.hostname}/ws?ticket=${ticket}`,
    };
  });
}
