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

  if (!response.ok) {
    const error = await response.text();
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
 * Combines authentication + connection lookup + URL generation
 */
export async function getDirectConnectionUrl(
  guacamoleUrl: string,
  username: string,
  password: string,
  machineNameOrIp: string
): Promise<{ url: string; connectionName: string }> {
  // 1. Authenticate
  const auth = await authenticateGuacamole(guacamoleUrl, username, password);

  // 2. Get available connections
  const connections = await getGuacamoleConnections(
    guacamoleUrl,
    auth.authToken,
    auth.dataSource
  );

  // 3. Find the connection for this machine
  const connection = findConnectionByName(connections, machineNameOrIp);

  if (!connection) {
    throw new Error(
      `No Guacamole connection found for machine: ${machineNameOrIp}. ` +
      `Available connections: ${connections.map(c => c.name).join(', ')}`
    );
  }

  // 4. Generate the direct URL
  const url = generateConnectionUrl(
    guacamoleUrl,
    auth.authToken,
    connection.identifier,
    auth.dataSource
  );

  return {
    url,
    connectionName: connection.name,
  };
}
