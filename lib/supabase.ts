import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// We store the active Clerk JWT token here
let currentClerkToken: string | null = null;

/**
 * Updates the active Clerk JWT token used by the Supabase client.
 * This should be called whenever the user's Clerk session changes.
 */
export const setSupabaseToken = (token: string | null) => {
  currentClerkToken = token;
};

// Create a Supabase client that dynamically injects the Clerk token into request headers
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: async (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      
      // If we have a Clerk token, inject it as the Authorization Bearer
      if (currentClerkToken) {
        headers.set('Authorization', `Bearer ${currentClerkToken}`);
      }
      
      return fetch(url, { ...options, headers });
    },
  },
});
