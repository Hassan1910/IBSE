import 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import {
  Syne_700Bold,
  Syne_800ExtraBold,
} from '@expo-google-fonts/syne';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { Stack, useRouter, useSegments, useRootNavigationState, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import { QueryClientProvider } from '@tanstack/react-query';
import { tokenCache } from '../lib/clerk';
import { useRole } from '../hooks/useRole';
import { setSupabaseToken, setSupabaseTokenGetter, supabase } from '../lib/supabase';
import { isMaintenanceMode } from '../lib/settings';
import { registerForPushNotifications } from '../lib/push';
import { queryClient } from '../lib/queryClient';
import {
  clearAuthIntent,
  getAuthIntent,
  isPaymentResumeHeld,
} from '../lib/authIntent';
import { setNotificationPushNavigation } from '../lib/notificationMoneySync';
import type { NotificationRole } from '../lib/notificationRoutes';
import 'react-native-reanimated';

export {
  ErrorBoundary,
} from 'expo-router';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const missingConfig: string[] = [];
if (!CLERK_PUBLISHABLE_KEY) missingConfig.push('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY');
if (!SUPABASE_URL) missingConfig.push('EXPO_PUBLIC_SUPABASE_URL');
if (!SUPABASE_ANON_KEY) missingConfig.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');

function MisconfiguredScreen({ missing }: { missing: string[] }) {
  return (
    <View style={styles.maintenanceContainer}>
      <Text style={styles.maintenanceTitle}>App misconfigured</Text>
      <Text style={styles.maintenanceBody}>
        This build is missing required environment variables, so IBSA Homes cannot start.
        Rebuild with EAS preview/production env vars set.
      </Text>
      <Text style={styles.missingKeys}>{missing.join('\n')}</Text>
    </View>
  );
}

function InitialLayout() {
  const { isLoaded: isAuthLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const { role, accountStatus, loading: isRoleLoading, refresh: refreshRole } = useRole();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const [maintenanceBlocked, setMaintenanceBlocked] = useState(false);
  const [checkingMaintenance, setCheckingMaintenance] = useState(false);
  const accountBlocked =
    isSignedIn &&
    !!role &&
    (accountStatus === 'pending' || accountStatus === 'rejected');

  // Register a dynamic token getter so every Supabase request uses a fresh
  // Clerk JWT. Clerk caches valid tokens and only refetches near expiry, which
  // prevents "JWT expired" (PGRST303) errors from a stale cached token.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  useEffect(() => {
    if (!isAuthLoaded) return;

    if (isSignedIn) {
      const fetchClerkToken = async () => {
        try {
          return await getTokenRef.current({ template: 'supabase' });
        } catch {
          // Template doesn't exist — fall back to default Clerk session token
          try {
            return await getTokenRef.current();
          } catch {
            return null;
          }
        }
      };
      setSupabaseTokenGetter(fetchClerkToken);
      // Bootstrap Realtime WebSocket auth immediately (REST uses the getter on each request).
      void fetchClerkToken().then((token) => {
        if (token) setSupabaseToken(token);
      });
    } else {
      setSupabaseTokenGetter(null);
      setSupabaseToken(null);
      setMaintenanceBlocked(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, isAuthLoaded]);

  // Register Expo push token once signed in with a resolved role.
  useEffect(() => {
    if (!isAuthLoaded || !isSignedIn || isRoleLoading || !role || !user?.id) return;
    registerForPushNotifications(user.id).catch((err) => {
      console.warn('[push] registration skipped:', err);
    });
  }, [isAuthLoaded, isSignedIn, isRoleLoading, role, user?.id]);

  // Push tap → deep link using current role.
  useEffect(() => {
    if (!role) {
      setNotificationPushNavigation(() => null, () => undefined);
      return;
    }
    setNotificationPushNavigation(
      () => role as NotificationRole,
      (target) => {
        if (!target) return;
        router.navigate(target as any);
      },
    );
  }, [role, router]);

  // Maintenance mode: block non-admin signed-in users.
  useEffect(() => {
    if (!isAuthLoaded || !isSignedIn || isRoleLoading || !role) {
      setMaintenanceBlocked(false);
      return;
    }
    if (role === 'admin' || role === 'finance') {
      setMaintenanceBlocked(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setCheckingMaintenance(true);
        const on = await isMaintenanceMode();
        if (!cancelled) setMaintenanceBlocked(on);
      } catch {
        if (!cancelled) setMaintenanceBlocked(false);
      } finally {
        if (!cancelled) setCheckingMaintenance(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthLoaded, isSignedIn, isRoleLoading, role]);

  // While pending/rejected, poll profile + listen for approval so unlock does not require a manual tap.
  useEffect(() => {
    if (!accountBlocked || !user?.id) return;

    const channel = supabase
      .channel(`account-approval:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        () => {
          refreshRole();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const type = (payload.new as { type?: string } | null)?.type;
          if (type === 'account_approval') refreshRole();
        },
      )
      .subscribe();

    const poll = setInterval(() => {
      refreshRole();
    }, 12000);

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [accountBlocked, user?.id, refreshRole]);

  // Handle Route Guard redirects based on role and auth status
  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!navigationState?.key) return;
    if (maintenanceBlocked) return;
    if (accountBlocked) return;

    let cancelled = false;

    const performRedirect = async () => {
      const inAuthGroup = segments[0] === '(auth)';
      // Root index (`/`) is the public listings landing — guests may stay there.
      const onPublicLanding = pathname === '/' || pathname === '';

      if (!isSignedIn) {
        // Guests may browse listings or use auth screens; everything else → login
        if (!inAuthGroup && !onPublicLanding) {
          router.replace('/(auth)/login');
        }
        return;
      }

      // Wait until the role finishes loading from Supabase
      if (isRoleLoading) return;

      if (!role) {
        // If logged in but no profile exists, let them stay in auth/signup or redirect to login
        if (!inAuthGroup) {
          router.replace('/(auth)/login');
        }
        return;
      }

      const currentGroup = segments[0];

      // Route mapping per role
      const roleGroups: Record<string, string> = {
        admin: '(admin)',
        finance: '(admin)', // Admins and Finance staff share the same dashboard navigation group
        tenant: '(tenant)',
        client: '(client)',
        landlord: '(landlord)',
      };

      const expectedGroup = roleGroups[role];
      const intent = await getAuthIntent();
      if (cancelled) return;

      // Mid-payment modal only: do not bounce away from Explore while the deposit/buy UI is open.
      if (currentGroup === '(client)' && isPaymentResumeHeld()) {
        return;
      }

      // Resume Pay Deposit / Buy after auth — clients only (tenants stay in tenant shell).
      // If already on Explore without params, properties.tsx resumes from AsyncStorage.
      if (intent && role === 'client') {
        const onProperties =
          currentGroup === '(client)' && (segments as string[]).includes('properties');
        if (onProperties) {
          return;
        }

        router.replace({
          pathname: '/(client)/properties',
          params: {
            action: intent.action,
            propertyId: intent.propertyId,
          },
        });
        return;
      }

      if (intent && role === 'tenant') {
        await clearAuthIntent();
      }

      if (currentGroup === expectedGroup) return;

      // Redirect to the correct role dashboard root
      if (role === 'admin' || role === 'finance') {
        if (intent) await clearAuthIntent();
        router.replace('/(admin)/dashboard');
      } else if (role === 'landlord') {
        if (intent) await clearAuthIntent();
        router.replace('/(landlord)/dashboard');
      } else if (role === 'tenant') {
        router.replace('/(tenant)/dashboard');
      } else {
        router.replace('/(client)/properties');
      }
    };

    // Defer redirect execution to allow the navigation tree to fully mount and register all child routes
    const timer = setTimeout(() => {
      void performRedirect();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isSignedIn,
    isAuthLoaded,
    role,
    isRoleLoading,
    segments,
    pathname,
    navigationState,
    maintenanceBlocked,
    accountBlocked,
    router,
  ]);

  if (!isAuthLoaded || (isSignedIn && isRoleLoading) || checkingMaintenance) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  if (maintenanceBlocked) {
    return (
      <View style={styles.maintenanceContainer}>
        <Text style={styles.maintenanceTitle}>Under Maintenance</Text>
        <Text style={styles.maintenanceBody}>
          IBSA Homes is temporarily unavailable. Please try again later, or contact support if you need urgent help.
        </Text>
        <TouchableOpacity style={styles.maintenanceBtn} onPress={() => signOut()}>
          <Text style={styles.maintenanceBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (accountBlocked) {
    const isRejected = accountStatus === 'rejected';
    return (
      <View style={styles.maintenanceContainer}>
        <Text style={styles.maintenanceTitle}>
          {isRejected ? 'Account Not Approved' : 'Account Pending Approval'}
        </Text>
        <Text style={styles.maintenanceBody}>
          {isRejected
            ? 'Your account was not approved. Contact an administrator if you believe this is a mistake.'
            : 'Your account is waiting for admin approval. You will be able to access the app once an administrator reviews your signup.'}
        </Text>
        {!isRejected ? (
          <TouchableOpacity
            style={[styles.maintenanceBtn, styles.checkStatusBtn]}
            onPress={() => refreshRole()}
          >
            <Text style={styles.checkStatusBtnText}>Check Status</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.maintenanceBtn} onPress={() => signOut()}>
          <Text style={styles.maintenanceBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(admin)" />
      <Stack.Screen name="(tenant)" />
      <Stack.Screen name="(client)" />
      <Stack.Screen name="(landlord)" />
      <Stack.Screen name="+not-found" options={{ headerShown: true }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Syne_700Bold,
    Syne_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (error) {
      console.warn('[fonts] Failed to load custom fonts:', error);
    }
  }, [error]);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  if (missingConfig.length > 0) {
    return <MisconfiguredScreen missing={missingConfig} />;
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <QueryClientProvider client={queryClient}>
        <InitialLayout />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  maintenanceContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 32,
  },
  maintenanceTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  maintenanceBody: {
    color: '#94A3B8',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  maintenanceBtn: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  checkStatusBtn: {
    backgroundColor: '#334155',
    marginBottom: 4,
  },
  checkStatusBtnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 15,
  },
  maintenanceBtnText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 15,
  },
  missingKeys: {
    color: '#F87171',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
});
