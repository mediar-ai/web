// Desktop app download URL (CrabNebula CDN)
export const DESKTOP_DOWNLOAD_URL = 'https://cdn.crabnebula.app/download/mediarai/mediar/latest/platform/windows-x86_64';

// Mediar organization IDs
export const MEDIAR_ORG_IDS = [
  'org_2yynzGa53bNM1GTPLp5mc2lYRyD', // Current Mediar organization
  'org_2yydAO45WOB4RaCE4F4BNUPtw9c', // Legacy Mediar organization
];

// Internal emails to exclude from stats (Posthog, user consumption, etc.)
export const EXCLUDED_EMAILS_FROM_STATS = [
  'matt@mediar.ai',
  'louis@mediar.ai',
  'dev@mediar.ai',
  'task@benchflow.ai',
  'adrian.z.mei@gmail.com',
];

// Pre-formatted for SQL queries
export const EXCLUDED_EMAILS_SQL = EXCLUDED_EMAILS_FROM_STATS.map(e => `'${e}'`).join(', ');