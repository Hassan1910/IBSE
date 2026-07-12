import 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '../lib/clerk';
import { useRole } from '../hooks/useRole';
import { setSupabaseToken, setSupabaseTokenGetter } from '../lib/supabase';
import { isMaintenanceMode } from '../lib/settings';
import 'react-native-reanimated';

export {
  ErrorBoundary,
} from 'expo-router';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '';

function InitialLayout() {
  const { isLoaded: isAuthLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { role, loading: isRoleLoading } = useRole();
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const [maintenanceBlocked, setMaintenanceBlocked] = useState(false);
  const [checkingMaintenance, setCheckingMaintenance] = useState(false);

  // Register a dynamic token getter so every Supabase request uses a fresh
  // Clerk JWT. Clerk caches valid tokens and only refetches near expiry, which
  // prevents "JWT expired" (PGRST303) errors from a stale cached token.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  useEffect(() => {
    if (!isAuthLoaded) return;

    if (isSignedIn) {
      setSupabaseTokenGetter(async () => {
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
      });
    } else {
      setSupabaseTokenGetter(null);
      setSupabaseToken(null);
      setMaintenanceBlocked(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, isAuthLoaded]);

  // Maintenance mode: block non-admin signed-in users.
  useEffect(() => {
    if (!isAuthLoaded || !isSignedIn || isRoleLoading || !role) {
      setMaintenanceBlocked(false);
      return;
    }
    if (role === 'admin') {
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

  // Handle Route Guard redirects based on role and auth status
  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!navigationState?.key) return;
    if (maintenanceBlocked) return;

    const performRedirect = () => {
      const inAuthGroup = segments[0] === '(auth)';

      if (!isSignedIn) {
        // If not logged in, force go to login
        if (!inAuthGroup) {
          router.replace('/(auth)/login');
        }
      } else {
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

        if (currentGroup !== expectedGroup) {
          // Redirect to the correct role dashboard root
          if (role === 'admin' || role === 'finance') {
            router.replace('/(admin)/dashboard');
          } else if (role === 'tenant') {
            router.replace('/(tenant)/dashboard');
          } else if (role === 'landlord') {
            router.replace('/(landlord)/dashboard');
          } else {
            router.replace('/(client)/properties');
          }
        }
      }
    };

    // Defer redirect execution to allow the navigation tree to fully mount and register all child routes
    const timer = setTimeout(performRedirect, 0);
    return () => clearTimeout(timer);
  }, [isSignedIn, isAuthLoaded, role, isRoleLoading, segments, navigationState, maintenanceBlocked, router]);

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

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(admin)" />
      <Stack.Screen name="(tenant)" />
      <Stack.Screen name="(client)" />
      <Stack.Screen name="(landlord)" />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      <Stack.Screen name="+not-found" options={{ headerShown: true }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <InitialLayout />
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
  },
  maintenanceBtnText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 15,
  },
});
