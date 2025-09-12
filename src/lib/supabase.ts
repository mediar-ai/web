import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase URL or anon key');
}

// Legacy client - gradually migrate to useClerkSupabase() or createClerkSupabaseClient()
// This client doesn't have authentication and won't work properly with RLS
// @deprecated Use useClerkSupabase() in components or createClerkSupabaseClient() in server
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Re-export the new Clerk-aware functions
export { useClerkSupabase } from './supabase-browser';
export { createClerkSupabaseClient, createServiceSupabaseClient } from './supabase-clerk'; 