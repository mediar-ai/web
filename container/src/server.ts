/**
 * Fastify server with WebSocket support
 */

import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { logger } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';
import { openaiCompatRoutes } from './routes/openai-compat.js';
import { handleConnection } from './websocket/handler.js';

export async function createServer() {
  const fastify = Fastify({
    logger: false, // We use our own pino logger
  });

  // CORS
  await fastify.register(fastifyCors, {
    origin: true, // TODO: Restrict in production
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // WebSocket
  await fastify.register(fastifyWebsocket, {
    options: {
      maxPayload: 1024 * 1024, // 1MB
    },
  });

  // WebSocket route for chat
  fastify.get('/chat', { websocket: true }, (socket, req) => {
    handleConnection(socket);
  });

  // REST routes
  await fastify.register(healthRoutes);
  await fastify.register(openaiCompatRoutes);

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url }, 'Request error');
    reply.status(500).send({ error: 'Internal server error' });
  });

  return fastify;
}
