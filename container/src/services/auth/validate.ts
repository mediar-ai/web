import { createClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger.js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export interface AuthenticatedUser {
  userId: string;
  email: string;
  organizationId: string;
  organizationName?: string;
}

/**
 * Validate a token and return the authenticated user info.
 * Supports both Supabase JWT tokens and API keys.
 */
export async function validateToken(token: string): Promise<AuthenticatedUser | null> {
  try {
    // First try as Supabase JWT
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (user && !error) {
      // Get organization from user metadata or lookup
      const orgId = user.user_metadata?.organization_id;

      if (!orgId) {
        // Lookup organization membership
        const { data: membership } = await supabase
          .from('organization_members')
          .select('organization_id, organizations(name)')
          .eq('user_id', user.id)
          .single();

        if (membership) {
          return {
            userId: user.id,
            email: user.email || '',
            organizationId: membership.organization_id,
            organizationName: (membership.organizations as any)?.name,
          };
        }
      }

      return {
        userId: user.id,
        email: user.email || '',
        organizationId: orgId || '',
      };
    }

    // Try as API key
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('user_id, organization_id, users(email), organizations(name)')
      .eq('key_hash', hashApiKey(token))
      .eq('is_active', true)
      .single();

    if (apiKey) {
      return {
        userId: apiKey.user_id,
        email: (apiKey.users as any)?.email || '',
        organizationId: apiKey.organization_id,
        organizationName: (apiKey.organizations as any)?.name,
      };
    }

    logger.warn('Token validation failed: no matching user or API key');
    return null;
  } catch (err) {
    logger.error({ err }, 'Token validation error');
    return null;
  }
}

function hashApiKey(key: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(key).digest('hex');
}
