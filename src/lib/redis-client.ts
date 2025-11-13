/**
 * Shared Redis client for the application
 * Single source of truth for Redis connections
 */

import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL environment variable is not set');
  }

  redisClient = createClient({
    url: process.env.REDIS_URL,
  });

  await redisClient.connect();

  console.log('[REDIS] Connected to Redis Cloud');

  return redisClient;
}

/**
 * Close Redis connection (for cleanup)
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
    console.log('[REDIS] Disconnected from Redis');
  }
}
