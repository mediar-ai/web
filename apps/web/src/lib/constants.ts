// Mediar organization IDs
export const MEDIAR_ORG_IDS = [
  'org_REDACTED', // Current Mediar organization
  'org_REDACTED', // Legacy Mediar organization
];

// Internal emails to exclude from stats (Posthog, user consumption, etc.)
export const EXCLUDED_EMAILS_FROM_STATS = [
  'matt@mediar.ai',
  'louis@mediar.ai',
  'dev@mediar.ai',
  'redacted@example.com',
  'redacted@example.com',
];

// Pre-formatted for SQL queries
export const EXCLUDED_EMAILS_SQL = EXCLUDED_EMAILS_FROM_STATS.map(e => `'${e}'`).join(', ');