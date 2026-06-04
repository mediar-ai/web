// Desktop app download URL (CrabNebula CDN)
export const DESKTOP_DOWNLOAD_URL = 'https://cdn.crabnebula.app/download/mediarai/mediar/latest/platform/windows-x86_64';

function parseList(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Mediar organization IDs.
//
// Sourced from NEXT_PUBLIC_MEDIAR_ORG_IDS (comma-separated) so the value is
// available in both server routes and client components without being
// committed to this (public) repository. If the env var is unset, the list is
// empty and Mediar-specific UI/handling simply does not apply.
export const MEDIAR_ORG_IDS = parseList(process.env.NEXT_PUBLIC_MEDIAR_ORG_IDS);

// Internal emails to exclude from stats (Posthog, user consumption, etc.).
// Mediar's own staff addresses are kept here; any additional internal/test
// addresses are supplied via the EXCLUDED_STATS_EMAILS env var (server-only)
// so non-Mediar addresses are not committed to the repo.
export const EXCLUDED_EMAILS_FROM_STATS = [
  'matt@mediar.ai',
  'dev@mediar.ai',
  ...parseList(process.env.EXCLUDED_STATS_EMAILS),
];

// Pre-formatted for SQL queries
export const EXCLUDED_EMAILS_SQL = EXCLUDED_EMAILS_FROM_STATS.map(e => `'${e}'`).join(', ');
