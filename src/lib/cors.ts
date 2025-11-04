/**
 * Shared CORS Configuration
 * Development-aware CORS headers for API routes
 */

import { NextResponse } from 'next/server';

// Determine environment
const isDevelopment = process.env.NODE_ENV === 'development';

// Allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:1420', // Tauri v1 dev (desktop app)
  'http://localhost:1421', // Tauri v1 dev alternative port
  'http://tauri.localhost', // Tauri v2 dev (desktop app)
  'tauri://localhost',     // Tauri production (built desktop app)
  'http://localhost:3000', // Next.js dev server
  'http://localhost:3001', // Alternative dev port
  'https://screenpipe.ai', // Production domain (if applicable)
  // Add your production domains here
];

/**
 * Get CORS headers for API responses
 * @param origin Optional origin to validate (from request headers)
 * @returns CORS headers object
 */
export function getCorsHeaders(origin?: string | null): Record<string, string> {
  // In development, allow all origins for easier testing
  if (isDevelopment) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
      'Access-Control-Max-Age': '86400', // 24 hours
      'Access-Control-Allow-Credentials': 'true',
    };
  }

  // Allow tauri:// origins (desktop app in production/built mode)
  // This handles both tauri://localhost and any other tauri:// protocol origins
  if (origin?.startsWith('tauri://')) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Allow-Credentials': 'true',
    };
  }

  // In production, validate origin against allowed list
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Create a standard OPTIONS handler for CORS preflight
 * @returns NextResponse with CORS headers
 */
export function createCorsOptionsHandler() {
  return async (request: Request) => {
    const origin = request.headers.get('origin');
    const headers = getCorsHeaders(origin);
    return new NextResponse(null, { status: 200, headers });
  };
}

/**
 * Add CORS headers to an existing response
 * @param response NextResponse to add headers to
 * @param origin Optional origin from request
 * @returns Response with CORS headers added
 */
export function addCorsHeaders(
  response: NextResponse,
  origin?: string | null
): NextResponse {
  const headers = getCorsHeaders(origin);
  
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
}

/**
 * Create a JSON response with CORS headers
 * @param data Data to return as JSON
 * @param init Response init options (status, etc.)
 * @param origin Optional origin from request
 * @returns NextResponse with JSON and CORS headers
 */
export function corsJsonResponse(
  data: any,
  init?: ResponseInit,
  origin?: string | null
): NextResponse {
  const headers = getCorsHeaders(origin);
  
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...init?.headers,
      ...headers,
    },
  });
}

/**
 * Validate if origin is allowed
 * @param origin Origin to check
 * @returns true if allowed
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (isDevelopment) return true; // Allow all in dev
  if (origin.startsWith('tauri://')) return true; // Allow all tauri:// origins
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Log CORS request for debugging
 * @param origin Request origin
 * @param path Request path
 */
export function logCorsRequest(origin: string | null, path: string): void {
  if (isDevelopment) {
    const allowed = isOriginAllowed(origin);
    console.log(`🌐 CORS: ${origin || 'no-origin'} → ${path} [${allowed ? 'ALLOWED' : 'BLOCKED'}]`);
  }
}

