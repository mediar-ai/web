import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Check environment variables without exposing their values
    const envStatus = {
      VERCEL: process.env.VERCEL,
      NODE_ENV: process.env.NODE_ENV,
      GOOGLE_CLOUD_PROJECT: !!process.env.GOOGLE_CLOUD_PROJECT,
      VERTEX_AI_LOCATION: !!process.env.VERTEX_AI_LOCATION,
      GOOGLE_APPLICATION_CREDENTIALS: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      GOOGLE_APPLICATION_CREDENTIALS_BASE64: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
      GOOGLE_APPLICATION_CREDENTIALS_BASE64_LENGTH: process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64?.length || 0,
    };

    // Determine which credential method would be used
    const isVercel = process.env.VERCEL === '1';
    const hasFileCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const hasBase64Credentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    
    let credentialMethod = 'default';
    let credentialStatus = 'unknown';
    
    if (isVercel && hasBase64Credentials) {
      credentialMethod = 'base64 (Vercel)';
      try {
        const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64!, 'base64').toString('utf-8');
        JSON.parse(credentialsJson);
        credentialStatus = 'valid JSON';
      } catch (error) {
        credentialStatus = `invalid JSON: ${error instanceof Error ? error.message : 'unknown error'}`;
      }
    } else if (!isVercel && hasFileCredentials) {
      credentialMethod = 'file-based (Local)';
      credentialStatus = 'file path set';
    } else if (hasBase64Credentials) {
      credentialMethod = 'base64 (Fallback)';
      try {
        const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64!, 'base64').toString('utf-8');
        JSON.parse(credentialsJson);
        credentialStatus = 'valid JSON';
      } catch (error) {
        credentialStatus = `invalid JSON: ${error instanceof Error ? error.message : 'unknown error'}`;
      }
    } else {
      credentialMethod = 'default Google Cloud authentication';
      credentialStatus = 'no explicit credentials';
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      environment: envStatus,
      credentialMethod,
      credentialStatus,
      isVercel,
      hasFileCredentials,
      hasBase64Credentials,
    });

  } catch (error) {
    return NextResponse.json({ 
      error: 'Debug endpoint error', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 