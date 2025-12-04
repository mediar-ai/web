import Redis from 'ioredis';
import { logger } from './logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.warn('REDIS_URL not set, using in-memory fallback');
      // Return a mock for development without Redis
      redis = new Redis({ lazyConnect: true });
      redis.disconnect();
    } else {
      redis = new Redis(redisUrl);
      redis.on('error', (err) => logger.error({ err }, 'Redis error'));
      redis.on('connect', () => logger.info('Redis connected'));
    }
  }
  return redis;
}

// Session storage interface
export interface Session {
  id: string;
  userId: string;
  organizationId: string;
  workflowId?: number;
  messages: Array<{ role: string; content: string }>;
  createdAt: string;
  lastActiveAt: string;
}

const SESSION_TTL = 60 * 60 * 24; // 24 hours

export async function getSession(sessionId: string): Promise<Session | null> {
  const redis = getRedis();
  const data = await redis.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export async function setSession(session: Session): Promise<void> {
  const redis = getRedis();
  await redis.setex(`session:${sessionId(session.id)}`, SESSION_TTL, JSON.stringify(session));
}

function sessionId(id: string): string {
  return id;
}

export async function updateSessionActivity(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (session) {
    session.lastActiveAt = new Date().toISOString();
    await setSession(session);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`session:${sessionId}`);
}
