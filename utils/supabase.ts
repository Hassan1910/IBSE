import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Active Clerk JWT token used by the Supabase client (fallback / bootstrap value)
let currentClerkToken: string | null = null;

// Function that returns a fresh Clerk JWT. Clerk caches valid tokens internally
// and only refetches when the current one is close to expiring, so this is safe
// to call on every request.
type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

/**
 * Updates the cached Clerk JWT token used by the Supabase client.
 * Used as a bootstrap value before the dynamic getter is registered.
 */
export const setSupabaseToken = (token: string | null) => {
  currentClerkToken = token;
};

/**
 * Registers a function that returns a fresh Clerk JWT for each Supabase request.
 * This prevents "JWT expired" (PGRST303) errors caused by caching a stale token.
 */
export const setSupabaseTokenGetter = (getter: TokenGetter | null) => {
  tokenGetter = getter;
};

// Supabase client configured with AsyncStorage and dynamic Clerk JWT headers
// #region agent log
console.log('[DEBUG d1d833] supabase module init', { hasUrl: !!supabaseUrl, hasKey: !!supabaseAnonKey });
// #endregion
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

      // Prefer a freshly fetched token so we never send an expired JWT.
      let token = currentClerkToken;
      if (tokenGetter) {
        try {
          const fresh = await tokenGetter();
          console.log('[DEBUG FETCH] tokenGetter returned:', fresh ? `${fresh.substring(0, 15)}...` : 'null/undefined');
          if (fresh) {
            token = fresh;
            currentClerkToken = fresh;
          }
        } catch (err: any) {
          console.error('[DEBUG FETCH] tokenGetter threw error:', err.message || err);
          // Fall back to the last known token if refresh fails.
        }
      } else {
        console.log('[DEBUG FETCH] tokenGetter is not set');
      }

      console.log('[DEBUG FETCH] sending token:', token ? `${token.substring(0, 15)}...` : 'null/undefined');
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(url, { ...options, headers });
    },
  },
});
