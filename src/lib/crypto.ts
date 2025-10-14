/**
 * Encryption utilities for secrets management
 * Uses AES-256-GCM for secure encryption
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits recommended for GCM

/**
 * Get or generate the master encryption key from environment
 * In production, this should be a secure random key stored in environment variables
 */
function getMasterKey(): string {
  const key = process.env.SECRETS_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('SECRETS_ENCRYPTION_KEY environment variable is not set');
  }
  return key;
}

/**
 * Derive a CryptoKey from the master key string
 */
async function deriveKey(masterKey: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(masterKey);

  // Hash the key material to get consistent 256-bit key
  const keyHash = await crypto.subtle.digest('SHA-256', keyMaterial);

  return crypto.subtle.importKey(
    'raw',
    keyHash,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a secret value
 * @param plaintext - The secret value to encrypt
 * @returns Base64-encoded encrypted value with IV prepended
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const masterKey = getMasterKey();
  const key = await deriveKey(masterKey);

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Encode plaintext
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Return as base64
  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypt a secret value
 * @param encrypted - Base64-encoded encrypted value with IV prepended
 * @returns Decrypted plaintext secret
 */
export async function decryptSecret(encrypted: string): Promise<string> {
  const masterKey = getMasterKey();
  const key = await deriveKey(masterKey);

  // Decode from base64
  const combined = Buffer.from(encrypted, 'base64');

  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );

  // Decode to string
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Validate secret name format
 * Must be uppercase alphanumeric with underscores, like environment variable names
 */
export function validateSecretName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

/**
 * Sanitize secret name to valid format
 */
export function sanitizeSecretName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/^[0-9]/, '_$&') // Ensure it doesn't start with a number
    .replace(/_+/g, '_'); // Remove duplicate underscores
}
