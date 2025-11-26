// Sensitive field patterns to redact from API responses
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api_?key/i,
  /totp/i,
  /otp/i,
  /credential/i,
  /private/i,
];

/**
 * Redact sensitive values from an object recursively.
 * Fields matching sensitive patterns will have their values replaced with '[REDACTED]'.
 */
export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Check if this key is sensitive
      const isSensitiveKey = SENSITIVE_FIELD_PATTERNS.some((pattern) =>
        pattern.test(key)
      );

      if (isSensitiveKey && typeof value === 'string' && value.length > 0) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result;
  }

  return obj;
}
