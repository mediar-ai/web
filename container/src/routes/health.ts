import { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
    };
  });

  fastify.get('/ready', async () => {
    // TODO: Check Redis, DB connections
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  });
}
