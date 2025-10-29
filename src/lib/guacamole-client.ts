/**
 * Guacamole REST API Client
 *
 * Provides helpers to authenticate with Apache Guacamole and generate
 * direct connection URLs for embedding RDP sessions.
 */

export interface GuacamoleAuthResponse {
  authToken: string;
  username: string;
  dataSource: string;
  availableDataSources: string[];
}

export interface GuacamoleConnection {
  identifier: string;
  name: string;
  protocol: string;
  activeConnections: number;
}

export interface GuacamoleConnectionParams {
  connectionId: string;
  connectionName: string;
  machineIp: string;
  dataSource?: string;
}

/**
 * Authenticate with Guacamole REST API and get auth token
 */
export async function authenticateGuacamole(
  guacamoleUrl: string,
  username: string,
  password: string
): Promise<GuacamoleAuthResponse> {
  console.log('[Guacamole Auth] Attempting authentication:', {
    url: guacamoleUrl,
    username,
    passwordLength: password?.length || 0,
    hasPassword: !!password
  });

  const response = await fetch(`${guacamoleUrl}/api/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      username,
      password,
    }),
  });

  console.log('[Guacamole Auth] Response status:', response.status);

  if (!response.ok) {
    const error = await response.text();
    console.error('[Guacamole Auth] Authentication failed:', error);
    throw new Error(`Guacamole authentication failed: ${error}`);
  }

  return response.json();
}

/**
 * Get list of available connections for authenticated user
 */
export async function getGuacamoleConnections(
  guacamoleUrl: string,
  authToken: string,
  dataSource: string
): Promise<GuacamoleConnection[]> {
  const response = await fetch(
    `${guacamoleUrl}/api/session/data/${dataSource}/connections?token=${authToken}`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch Guacamole connections');
  }

  const connections = await response.json();

  // Convert object to array
  return Object.entries(connections).map(([id, conn]: [string, any]) => ({
    identifier: id,
    name: conn.name,
    protocol: conn.protocol,
    activeConnections: conn.activeConnections || 0,
  }));
}

/**
 * Find a connection by name (supports partial matching)
 */
export function findConnectionByName(
  connections: GuacamoleConnection[],
  searchName: string
): GuacamoleConnection | null {
  // Try exact match first
  let match = connections.find(c => c.name === searchName);
  if (match) return match;

  // Try case-insensitive match
  match = connections.find(
    c => c.name.toLowerCase() === searchName.toLowerCase()
  );
  if (match) return match;

  // Try partial match (contains)
  match = connections.find(c =>
    c.name.toLowerCase().includes(searchName.toLowerCase())
  );
  if (match) return match;

  return null;
}

/**
 * Generate direct connection URL for embedding in iframe
 * This bypasses the Guacamole login screen
 */
export function generateConnectionUrl(
  guacamoleUrl: string,
  authToken: string,
  connectionId: string,
  dataSource: string = 'default'
): string {
  // Build the client URL with auth token
  // Format: /guacamole/#/client/{connectionId}?token={authToken}
  return `${guacamoleUrl}/#/client/${connectionId}?token=${authToken}`;
}

/**
 * Helper to get a direct connection URL for a specific machine
 * Works with file-based authentication (user-mapping.xml)
 */
export async function getDirectConnectionUrl(
  guacamoleUrl: string,
  username: string,
  password: string,
  machineNameOrIp: string
): Promise<{ url: string; connectionName: string }> {
  // 1. Authenticate to get token
  const auth = await authenticateGuacamole(guacamoleUrl, username, password);

  // 2. For file-based authentication (user-mapping.xml), the connection name
  //    is used directly in the URL format: /client/c/{connection-name}
  //    The connection name should match what's in user-mapping.xml
  const connectionName = `MCP-${machineNameOrIp}`;

  console.log('[Guacamole] Generating connection URL:', {
    connectionName,
    machineNameOrIp,
    authToken: auth.authToken.substring(0, 10) + '...',
  });

  // 3. Generate URL with file-based auth format
  // Format for user-mapping.xml: /guacamole/#/client/c/{connection-name}?token={token}
  const url = `${guacamoleUrl}/#/client/c/${encodeURIComponent(connectionName)}?token=${auth.authToken}`;

  return {
    url,
    connectionName,
  };
}
