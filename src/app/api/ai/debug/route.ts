import { NextResponse } from 'next/server';

export async function GET() {
  const diagnostics = {
    google_credentials: {
      has_base64: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
      has_json: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
      base64_length: process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64?.length || 0,
      json_length: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.length || 0,
    },
    google_project: {
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'NOT SET',
      GOOGLE_VERTEX_PROJECT: process.env.GOOGLE_VERTEX_PROJECT || 'NOT SET',
      GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID || 'NOT SET',
    },
    vertex_location: process.env.VERTEX_AI_LOCATION || process.env.GOOGLE_VERTEX_LOCATION || 'NOT SET',
    supabase: {
      has_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      has_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    }
  };

  return NextResponse.json(diagnostics);
}
