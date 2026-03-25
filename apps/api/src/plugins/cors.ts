import cors from '@fastify/cors';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function corsPlugin(fastify: FastifyInstance) {
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });
}

export default fp(corsPlugin, { name: 'cors' });
