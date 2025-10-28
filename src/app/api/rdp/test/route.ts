import { NextResponse } from 'next/server';

/**
 * Test endpoint to verify Guacamole environment variables and connectivity
 */
export async function GET() {
  const GUACAMOLE_URL = process.env.GUACAMOLE_URL || 'NOT_SET';
  const GUACAMOLE_USERNAME = process.env.GUACAMOLE_USERNAME || 'NOT_SET';
  const GUACAMOLE_PASSWORD = process.env.GUACAMOLE_PASSWORD || 'NOT_SET';

  const result: any = {
    envVars: {
      GUACAMOLE_URL,
      GUACAMOLE_USERNAME,
      GUACAMOLE_PASSWORD: GUACAMOLE_PASSWORD === 'NOT_SET' ? 'NOT_SET' : '[REDACTED]',
      passwordLength: GUACAMOLE_PASSWORD.length,
    },
  };

  // Test connectivity
  try {
    const testUrl = `${GUACAMOLE_URL}/api/tokens`;
    result.testUrl = testUrl;

    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        username: GUACAMOLE_USERNAME,
        password: GUACAMOLE_PASSWORD,
      }),
    });

    result.responseStatus = response.status;
    result.responseStatusText = response.statusText;

    const responseText = await response.text();
    result.responseBody = responseText;

    if (response.ok) {
      result.authSuccess = true;
      try {
        const authData = JSON.parse(responseText);
        result.authToken = authData.authToken ? '[TOKEN RECEIVED]' : '[NO TOKEN]';
      } catch (e) {
        result.parseError = 'Failed to parse response as JSON';
      }
    } else {
      result.authSuccess = false;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json(result);
}
