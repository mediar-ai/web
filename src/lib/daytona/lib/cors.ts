/**
 * CORS Configuration for Hono (refactored from Next.js)
 */

// Determine environment
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

// Allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:1420', // Tauri v1 dev (desktop app)
  'http://localhost:1421', // Tauri v1 dev alternative port
  'http://tauri.localhost', // Tauri v2 dev (desktop app)
  'tauri://localhost',     // Tauri production (built desktop app)
  'http://localhost:3000', // Dev server
  'http://localhost:3001', // Alternative dev port
  'https://app.mediar.ai', // Production
];

/**
 * Get CORS headers for API responses
 */
export function getCorsHeaders(origin?: string | null): Record<string, string> {
  // In development/sandbox, allow all origins
  if (isDevelopment) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, x-daytona-preview-token',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Allow-Credentials': 'true',
    };
  }

  // Allow tauri:// origins
  if (origin?.startsWith('tauri://')) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, x-daytona-preview-token',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Allow-Credentials': 'true',
    };
  }

  // Validate origin against allowed list
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, x-daytona-preview-token',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Create JSON response with CORS headers (Hono compatible)
 */
export function corsJsonResponse(
  data: any,
  init?: { status?: number; headers?: Record<string, string> },
  origin?: string | null
): Response {
  const corsHeaders = getCorsHeaders(origin);

  return new Response(JSON.stringify(data), {
    status: init?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...init?.headers,
    },
  });
}

/**
 * Check if origin is allowed
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (isDevelopment) return true;
  if (origin.startsWith('tauri://')) return true;
  return ALLOWED_ORIGINS.includes(origin);
}
