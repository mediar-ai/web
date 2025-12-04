/**
 * Container service entry point
 * AI chat + MCP tool execution
 */

import { createServer } from './server.js';
import { logger } from './lib/logger.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  try {
    const server = await createServer();

    await server.listen({ port: PORT, host: HOST });

    logger.info({ port: PORT, host: HOST }, 'Container service started');
    logger.info(`WebSocket: ws://${HOST}:${PORT}/chat`);
    logger.info(`OpenAI API: http://${HOST}:${PORT}/v1/chat/completions`);
    logger.info(`Health: http://${HOST}:${PORT}/health`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down...');
      await server.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
