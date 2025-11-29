/**
 * KV API endpoint for VMs and desktop apps
 * Provides Redis access with org-scoped key isolation
 * All keys are automatically prefixed with org:{orgId}:
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getRedisClient } from '@/lib/redis-client';
import { getCorsHeaders } from '@/lib/cors';

const KV_DEFAULT_TTL = 60 * 60 * 24 * 30; // 30 days default

type KVAction =
  | 'get'
  | 'set'
  | 'del'
  | 'expire'
  | 'incr'
  | 'lpush'
  | 'rpush'
  | 'lpop'
  | 'rpop'
  | 'hset'
  | 'hget'
  | 'hgetall'
  | 'hincrby';

interface KVRequest {
  action: KVAction;
  key: string;
  value?: string | number;
  field?: string;
  fields?: Record<string, string | number>;
  elements?: (string | number)[];
  options?: {
    ex?: number;
    nx?: boolean;
    xx?: boolean;
  };
  seconds?: number;
  increment?: number;
}

function scopedKey(orgId: string, key: string): string {
  return `org:${orgId}:${key}`;
}

/**
 * OPTIONS: Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

/**
 * POST: Execute KV operations
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    // 1. Authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);

    if (!validation.valid || !validation.orgId) {
      return NextResponse.json(
        { error: 'Invalid token or missing org' },
        { status: 401, headers: corsHeaders }
      );
    }

    const orgId = validation.orgId;
    const body: KVRequest = await request.json();
    const { action, key } = body;

    if (!action || !key) {
      return NextResponse.json(
        { error: 'Missing action or key' },
        { status: 400, headers: corsHeaders }
      );
    }

    const redis = await getRedisClient();
    const fullKey = scopedKey(orgId, key);

    let result: unknown;

    switch (action) {
      case 'get': {
        result = await redis.get(fullKey);
        break;
      }

      case 'set': {
        const { value, options } = body;
        if (value === undefined) {
          return NextResponse.json(
            { error: 'Missing value for set' },
            { status: 400, headers: corsHeaders }
          );
        }

        const setOptions: Record<string, unknown> = {};
        if (options?.ex) setOptions.EX = options.ex;
        if (options?.nx) setOptions.NX = true;
        if (options?.xx) setOptions.XX = true;

        // Default TTL if not specified
        if (!options?.ex) {
          setOptions.EX = KV_DEFAULT_TTL;
        }

        result = await redis.set(fullKey, String(value), setOptions);
        break;
      }

      case 'del': {
        result = await redis.del(fullKey);
        break;
      }

      case 'expire': {
        const { seconds } = body;
        if (seconds === undefined) {
          return NextResponse.json(
            { error: 'Missing seconds for expire' },
            { status: 400, headers: corsHeaders }
          );
        }
        result = await redis.expire(fullKey, seconds);
        break;
      }

      case 'incr': {
        result = await redis.incr(fullKey);
        break;
      }

      case 'lpush': {
        const { elements } = body;
        if (!elements?.length) {
          return NextResponse.json(
            { error: 'Missing elements for lpush' },
            { status: 400, headers: corsHeaders }
          );
        }
        result = await redis.lPush(fullKey, elements.map(String));
        break;
      }

      case 'rpush': {
        const { elements } = body;
        if (!elements?.length) {
          return NextResponse.json(
            { error: 'Missing elements for rpush' },
            { status: 400, headers: corsHeaders }
          );
        }
        result = await redis.rPush(fullKey, elements.map(String));
        break;
      }

      case 'lpop': {
        result = await redis.lPop(fullKey);
        break;
      }

      case 'rpop': {
        result = await redis.rPop(fullKey);
        break;
      }

      case 'hset': {
        const { field, value, fields } = body;
        if (fields) {
          // Object form: hset(key, {field1: val1, field2: val2})
          const entries = Object.entries(fields).flat().map(String);
          result = await redis.hSet(fullKey, entries);
        } else if (field !== undefined && value !== undefined) {
          // Single field form: hset(key, field, value)
          result = await redis.hSet(fullKey, field, String(value));
        } else {
          return NextResponse.json(
            { error: 'Missing field/value or fields for hset' },
            { status: 400, headers: corsHeaders }
          );
        }
        break;
      }

      case 'hget': {
        const { field } = body;
        if (field === undefined) {
          return NextResponse.json(
            { error: 'Missing field for hget' },
            { status: 400, headers: corsHeaders }
          );
        }
        result = await redis.hGet(fullKey, field);
        break;
      }

      case 'hgetall': {
        result = await redis.hGetAll(fullKey);
        break;
      }

      case 'hincrby': {
        const { field, increment } = body;
        if (field === undefined || increment === undefined) {
          return NextResponse.json(
            { error: 'Missing field or increment for hincrby' },
            { status: 400, headers: corsHeaders }
          );
        }
        result = await redis.hIncrBy(fullKey, field, increment);
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400, headers: corsHeaders }
        );
    }

    return NextResponse.json({ result }, { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error('[KV API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
