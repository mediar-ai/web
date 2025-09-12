import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

/**
 * Creates a Supabase client with Clerk authentication
 * This client will respect RLS policies based on the Clerk user
 */
export async function createClerkSupabaseClient() {
  const { userId, getToken } = await auth();
  
  if (!userId) {
    throw new Error('User not authenticated');
  }

  // Get the JWT token from Clerk with Supabase template
  const token = await getToken({ template: 'supabase' });
  
  if (!token) {
    throw new Error('Failed to get Supabase token from Clerk');
  }

  // Create a Supabase client with the Clerk JWT
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  return supabase;
}

/**
 * Creates a Supabase service client that bypasses RLS
 * Use this only in server-side API routes when you need full access
 * Always validate user permissions before using this client!
 */
export function createServiceSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Helper to get current Clerk user ID for queries
 */
export async function getClerkUserId() {
  const { userId } = await auth();
  return userId;
}

/**
 * Example usage in an API route:
 * 
 * // For user-scoped queries (respects RLS):
 * const supabase = await createClerkSupabaseClient();
 * const { data, error } = await supabase
 *   .from('low_level_workflows')
 *   .select('*'); // Will only return user's own workflows
 * 
 * // For admin operations (bypasses RLS):
 * const userId = await getClerkUserId();
 * if (!userId) return unauthorized();
 * 
 * const serviceClient = createServiceSupabaseClient();
 * // Always validate permissions when using service client!
 * const { data: user } = await serviceClient
 *   .from('mediar_users')
 *   .select('role')
 *   .eq('user_id', userId)
 *   .single();
 * 
 * if (user?.role !== 'admin') return forbidden();
 * 
 * // Now safe to perform admin operations
 * const { data, error } = await serviceClient
 *   .from('low_level_workflows')
 *   .select('*'); // Returns all workflows
 */