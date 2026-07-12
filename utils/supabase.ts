import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/** True when client env was baked into the JS bundle (local .env or EAS env). */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Placeholders keep createClient from throwing when env is missing; the root
// layout shows a misconfigured screen and never mounts authenticated flows.
const clientUrl = isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co';
const clientKey = isSupabaseConfigured
  ? supabaseAnonKey
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDUxOTI4MDAsImV4cCI6MTk2MDc2ODgwMH0.placeholder';

// Active Clerk JWT token used by the Supabase client (fallback / bootstrap value)
let currentClerkToken: string | null = null;

// Function that returns a fresh Clerk JWT. Clerk caches valid tokens internally
// and only refetches when the current one is close to expiring, so this is safe
// to call on every request.
type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

// Supabase client configured with AsyncStorage and dynamic Clerk JWT headers
export const supabase = createClient(clientUrl, clientKey, {
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
          if (fresh) {
            if (fresh !== currentClerkToken) {
              currentClerkToken = fresh;
              // Realtime WebSocket does not use custom fetch — keep its JWT in sync.
              void supabase.realtime.setAuth(fresh);
            } else {
              currentClerkToken = fresh;
            }
            token = fresh;
          }
        } catch {
          // Fall back to the last known token if refresh fails.
        }
      }

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(url, { ...options, headers });
    },
  },
});

/**
 * Updates the cached Clerk JWT token used by the Supabase client.
 * Used as a bootstrap value before the dynamic getter is registered.
 * Also syncs Realtime auth (WebSocket does not go through the custom fetch).
 */
export const setSupabaseToken = (token: string | null) => {
  currentClerkToken = token;
  void supabase.realtime.setAuth(token ?? '');
};

/**
 * Registers a function that returns a fresh Clerk JWT for each Supabase request.
 * This prevents "JWT expired" (PGRST303) errors caused by caching a stale token.
 */
export const setSupabaseTokenGetter = (getter: TokenGetter | null) => {
  tokenGetter = getter;
};
