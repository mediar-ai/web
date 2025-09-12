'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useAuth } from '@clerk/nextjs';
import { useMemo } from 'react';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Hook to create a Supabase client with Clerk authentication for use in React components
 * This client will respect RLS policies based on the authenticated Clerk user
 */
export function useClerkSupabase() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const supabase = useMemo(() => {
    // Create base client
    const client = createBrowserClient(supabaseUrl, supabaseAnonKey);
    
    // If Clerk is loaded and user is signed in, add auth header
    if (isLoaded && isSignedIn) {
      // Get token and set auth header
      getToken({ template: 'supabase' }).then(token => {
        if (token) {
          // Update the client's auth header
          client.rest.headers['Authorization'] = `Bearer ${token}`;
          client.realtime.headers['Authorization'] = `Bearer ${token}`;
        }
      });
    }
    
    return client;
  }, [isLoaded, isSignedIn, getToken]);

  return supabase;
}

/**
 * Creates a Supabase client with a specific Clerk token
 * Useful for one-time queries where you already have the token
 */
export async function createClerkSupabaseBrowser(token: string | null) {
  if (!token) {
    // Return unauthenticated client
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

/**
 * Helper hook for common Supabase queries with Clerk auth
 */
export function useSupabaseQuery<T>(
  queryFn: (client: ReturnType<typeof createBrowserClient>) => Promise<{ data: T | null; error: any }>
) {
  const supabase = useClerkSupabase();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const result = await queryFn(supabase);
        setData(result.data);
        setError(result.error);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [supabase]);

  return { data, error, loading };
}

// Import React hooks for the helper
import { useState, useEffect } from 'react';