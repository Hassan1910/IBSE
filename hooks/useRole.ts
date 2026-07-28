import { useUser, useAuth } from '@clerk/clerk-expo';
import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase, setSupabaseToken } from '../lib/supabase';

export type UserRole = 'admin' | 'finance' | 'tenant' | 'client' | 'landlord';
export type AccountStatus = 'pending' | 'approved' | 'rejected';

export function useRole() {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken, isLoaded: isAuthLoaded } = useAuth();
  const [role, setRole] = useState<UserRole | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Stable refs to avoid re-render loops
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const isFetchingRef = useRef(false);
  const lastFetchKeyRef = useRef<string | null>(null);
  const missingProfileRetriesRef = useRef(0);

  useEffect(() => {
    if (!isUserLoaded || !isAuthLoaded) return;

    if (!user) {
      setRole((prev) => (prev === null ? prev : null));
      setAccountStatus((prev) => (prev === null ? prev : null));
      setLoading((prev) => (prev === false ? prev : false));
      lastFetchKeyRef.current = null;
      missingProfileRetriesRef.current = 0;
      return;
    }

    const fetchKey = `${user.id}:${refreshNonce}`;
    if (isFetchingRef.current || lastFetchKeyRef.current === fetchKey) return;

    let cancelled = false;
    isFetchingRef.current = true;

    async function doFetch() {
      try {
        setLoading(true);

        let token: string | null = null;
        try {
          token = await getTokenRef.current({ template: 'supabase' });
        } catch {
          try {
            token = await getTokenRef.current();
          } catch {
            // Token fetch completely failed
          }
        }

        if (cancelled) return;
        setSupabaseToken(token);

        const { data, error: sbError } = await supabase
          .from('profiles')
          .select('role, account_status')
          .eq('id', user!.id)
          .single();

        if (cancelled) return;

        if (sbError) {
          if (sbError.code === 'PGRST116') {
            // Profile may still be inserting during signup/login — retry with backoff.
            setRole(null);
            setAccountStatus(null);
            missingProfileRetriesRef.current += 1;
            const attempt = missingProfileRetriesRef.current;
            const delay = attempt <= 6 ? 400 : Math.min(3000 + (attempt - 6) * 1000, 15000);
            setTimeout(() => {
              if (!cancelled) setRefreshNonce((n) => n + 1);
            }, delay);
          } else if (sbError.code === 'PGRST301') {
            setRole(null);
            setAccountStatus(null);
            lastFetchKeyRef.current = fetchKey;
          } else {
            console.error('[useRole] Supabase error:', sbError);
            setError(sbError.message);
            lastFetchKeyRef.current = fetchKey;
          }
        } else if (data) {
          missingProfileRetriesRef.current = 0;
          setRole(data.role as UserRole);
          setAccountStatus((data.account_status as AccountStatus) || 'approved');
          setError(null);
          lastFetchKeyRef.current = fetchKey;
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[useRole] Unhandled exception:', err);
          setError(err.message || 'Failed to determine user role');
          setRole(null);
          setAccountStatus(null);
          lastFetchKeyRef.current = fetchKey;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isUserLoaded, isAuthLoaded, refreshNonce]);

  // Retry when app returns to foreground if profile never resolved.
  useEffect(() => {
    if (!user?.id) return;
    const onChange = (state: AppStateStatus) => {
      if (state === 'active' && !role) {
        isFetchingRef.current = false;
        missingProfileRetriesRef.current = 0;
        setRefreshNonce((n) => n + 1);
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [user?.id, role]);

  const refresh = useCallback(() => {
    isFetchingRef.current = false;
    missingProfileRetriesRef.current = 0;
    lastFetchKeyRef.current = null;
    setLoading(true);
    setRefreshNonce((n) => n + 1);
  }, []);

  return { role, accountStatus, loading, error, refresh };
}
