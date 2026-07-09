import 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '../lib/clerk';
import { useRole } from '../hooks/useRole';
import { setSupabaseToken, setSupabaseTokenGetter } from '../lib/supabase';
import 'react-native-reanimated';

export {
  ErrorBoundary,
} from 'expo-router';

// #region agent log
console.log('[DEBUG d1d833] _layout module loaded (JS bundle executing on device)');
// #endregion

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '';

function InitialLayout() {
  const { isLoaded: isAuthLoaded, isSignedIn, getToken } = useAuth();
  const { role, loading: isRoleLoading } = useRole();
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();

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
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, isAuthLoaded]);

  // Handle Route Guard redirects based on role and auth status
  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!navigationState?.key) return;

    const performRedirect = () => {
      const inAuthGroup = segments[0] === '(auth)';
      console.log('[RootLayout] Guard check - segments:', segments, 'role:', role, 'isSignedIn:', isSignedIn, 'isRoleLoading:', isRoleLoading);

      if (!isSignedIn) {
        // If not logged in, force go to login
        if (!inAuthGroup) {
          console.log('[RootLayout] Not signed in, redirecting to login');
          router.replace('/(auth)/login');
        }
      } else {
        // Wait until the role finishes loading from Supabase
        if (isRoleLoading) return;

        if (!role) {
          // If logged in but no profile exists, let them stay in auth/signup or redirect to login
          if (!inAuthGroup) {
            console.log('[RootLayout] No role profile found, redirecting to login');
            router.replace('/(auth)/login');
          }
          return;
        }

        const currentGroup = segments[0];

        // Route mapping per role
        const roleGroups: Record<string, string> = {
          admin: '(admin)',
          finance: '(admin)', // Admins and Finance staff share the same dashboard navigation group
          booking: '(booking)',
          tenant: '(tenant)',
          client: '(client)',
          landlord: '(landlord)',
        };

        const expectedGroup = roleGroups[role];

        if (currentGroup !== expectedGroup) {
          console.log('[RootLayout] Mismatch! currentGroup:', currentGroup, 'expectedGroup:', expectedGroup, 'redirecting to expected dashboard');
          // Redirect to the correct role dashboard root
          if (role === 'admin' || role === 'finance') {
            router.replace('/(admin)/dashboard');
          } else if (role === 'booking') {
            router.replace('/(booking)/dashboard');
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
  }, [isSignedIn, isAuthLoaded, role, isRoleLoading, segments, navigationState]);

  if (!isAuthLoaded || (isSignedIn && isRoleLoading)) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(admin)" />
      <Stack.Screen name="(tenant)" />
      <Stack.Screen name="(booking)" />
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

  // #region agent log
  console.log('[DEBUG d1d833] RootLayout render', { fontLoaded: loaded, fontError: !!error, hasClerkKey: !!CLERK_PUBLISHABLE_KEY });
  // #endregion

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
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
