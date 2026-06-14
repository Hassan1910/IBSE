import { useUser, useAuth } from '@clerk/clerk-expo';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, setSupabaseToken } from '../lib/supabase';

export type UserRole = 'admin' | 'finance' | 'booking' | 'tenant' | 'client';

export function useRole() {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken, isLoaded: isAuthLoaded } = useAuth();
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable refs to avoid re-render loops
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const isFetchingRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isUserLoaded || !isAuthLoaded) return;

    if (!user) {
      // Only update state if it actually changed
      setRole((prev) => prev === null ? prev : null);
      setLoading((prev) => prev === false ? prev : false);
      lastUserIdRef.current = null;
      return;
    }

    // Skip if we already fetched for this user
    if (isFetchingRef.current || lastUserIdRef.current === user.id) return;

    let cancelled = false;
    isFetchingRef.current = true;

    async function doFetch() {
      try {
        setLoading(true);

        // Get Clerk token for Supabase
        let token: string | null = null;
        try {
          token = await getTokenRef.current({ template: 'supabase' });
        } catch {
          // Template doesn't exist yet — use default Clerk session token
          try {
            token = await getTokenRef.current();
          } catch {
            // Token fetch completely failed
          }
        }

        if (cancelled) return;
        setSupabaseToken(token);

        // Query profiles table
        const { data, error: sbError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user!.id)
          .single();

        if (cancelled) return;

        if (sbError) {
          if (sbError.code === 'PGRST116') {
            // Profile not created yet
            setRole(null);
          } else if (sbError.code === 'PGRST301') {
            // JWT not configured in Supabase
            setRole(null);
          } else {
            console.error('[useRole] Supabase error:', sbError);
            setError(sbError.message);
          }
        } else if (data) {
          setRole(data.role as UserRole);
          setError(null);
        }

        if (!cancelled) {
          lastUserIdRef.current = user!.id;
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[useRole] Unhandled exception:', err);
          setError(err.message || 'Failed to determine user role');
          setRole(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          isFetchingRef.current = false;
        }
      }
    }

    doFetch();

    return () => {
      cancelled = true;
      isFetchingRef.current = false;
    };
    // Only re-run when user identity or auth loaded state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isUserLoaded, isAuthLoaded]);

  // Manual refresh (e.g. after profile creation)
  const refresh = useCallback(() => {
    lastUserIdRef.current = null; // Reset so effect will re-fetch
    isFetchingRef.current = false;
    // Force a re-render by toggling loading
    setLoading(true);
  }, []);

  return { role, loading, error, refresh };
}
