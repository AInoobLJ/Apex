import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';

async function authPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for CORS preflight and health check
    if (request.method === 'OPTIONS') return;
    if (request.url === '/api/v1/system/health') return;
    if (request.url === '/api/v1/system/ready') return;
    if (request.url.startsWith('/ws')) return;

    const apiKey = request.headers['x-api-key'];
    if (!apiKey || apiKey !== config.API_KEY) {
      reply.code(401).send({ error: 'Unauthorized: invalid or missing API key' });
    }
  });
}

export default fp(authPlugin, { name: 'auth' });
