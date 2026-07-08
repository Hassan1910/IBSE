import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Active Clerk JWT token used by the Supabase client
let currentClerkToken: string | null = null;

/**
 * Updates the active Clerk JWT token used by the Supabase client.
 */
export const setSupabaseToken = (token: string | null) => {
  currentClerkToken = token;
};

// Supabase client configured with AsyncStorage and dynamic Clerk JWT headers
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: async (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (currentClerkToken) {
        headers.set('Authorization', `Bearer ${currentClerkToken}`);
      }
      return fetch(url, { ...options, headers });
    },
  },
});
