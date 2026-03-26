import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { logger } from './lib/logger';
import corsPlugin from './plugins/cors';
import authPlugin from './plugins/auth';
import websocketPlugin from './plugins/websocket';
import marketRoutes from './routes/markets';
import edgeRoutes from './routes/edges';
import systemRoutes from './routes/system';
import executionRoutes from './routes/execution';
import portfolioRoutes from './routes/portfolio';
import alertRoutes from './routes/alerts';
import signalRoutes from './routes/signals';
import sigintRoutes from './routes/sigint';
import nexusRoutes from './routes/nexus';
import backtestRoutes from './routes/backtest';
import cryptoRoutes from './routes/crypto';
import opportunityRoutes from './routes/opportunities';

export async function buildServer() {
  const server = Fastify({
    loggerInstance: logger,
  });

  // Register plugins
  await server.register(rateLimit, {
    max: 100,           // 100 requests per minute per API key
    timeWindow: '1 minute',
    keyGenerator: (request) => (request.headers['x-api-key'] as string) || request.ip,
  });
  await server.register(corsPlugin);
  await server.register(authPlugin);
  await server.register(websocketPlugin);

  // Register routes
  await server.register(marketRoutes, { prefix: '/api/v1' });
  await server.register(edgeRoutes, { prefix: '/api/v1' });
  await server.register(systemRoutes, { prefix: '/api/v1' });
  await server.register(executionRoutes, { prefix: '/api/v1' });
  await server.register(portfolioRoutes, { prefix: '/api/v1' });
  await server.register(alertRoutes, { prefix: '/api/v1' });
  await server.register(signalRoutes, { prefix: '/api/v1' });
  await server.register(sigintRoutes, { prefix: '/api/v1' });
  await server.register(nexusRoutes, { prefix: '/api/v1' });
  await server.register(backtestRoutes, { prefix: '/api/v1' });
  await server.register(cryptoRoutes, { prefix: '/api/v1' });
  await server.register(opportunityRoutes, { prefix: '/api/v1' });

  return server;
}
