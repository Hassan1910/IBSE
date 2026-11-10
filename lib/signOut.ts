import { router } from 'expo-router';
import { clearCachedClerkClient } from './clerk';
import { clearAuthIntent, setPaymentResumeHold } from './authIntent';
import { queryClient } from './queryClient';
import { setSupabaseToken, setSupabaseTokenGetter, supabase } from './supabase';

type ClerkSignOut = () => Promise<unknown>;

const resetListeners = new Set<() => void>();

let signOutInProgress = false;
let localSessionEpoch = 0;

/** Bumped when local session state is wiped, so in-flight role fetches cannot restore it. */
export function getLocalSessionEpoch(): number {
  return localSessionEpoch;
}

export function onLocalSessionCleared(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}

/** True while Clerk sign-out is in flight, including the gap before React sees `isSignedIn === false`. */
export function isSignOutInProgress(): boolean {
  return signOutInProgress;
}

/** Root guard calls this once it observes a signed-out session, so later navigations work normally. */
export function settleSignOutGuard(): void {
  signOutInProgress = false;
}

export function signOutErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'errors' in error) {
    const errors = (error as { errors?: Array<{ message?: string }> }).errors;
    const message = errors?.[0]?.message;
    if (message) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Could not sign out. Please try again.';
}

async function clearLocalSession(): Promise<void> {
  setSupabaseTokenGetter(null);
  setSupabaseToken(null);
  setPaymentResumeHold(false);
  await queryClient.cancelQueries();
  queryClient.clear();
  localSessionEpoch += 1;
  resetListeners.forEach((listener) => listener());

  await Promise.all([
    clearAuthIntent().catch((error: unknown) => {
      console.warn('[signOut] Failed to clear pending auth intent:', error);
    }),
    clearCachedClerkClient().catch((error: unknown) => {
      console.warn('[signOut] Failed to clear cached Clerk client:', error);
    }),
    // The app authenticates Supabase with a Clerk JWT, but the client still
    // persists its own auth storage. Drop that so a refresh cannot reuse it.
    supabase.auth.signOut({ scope: 'local' }).catch((error: unknown) => {
      console.warn('[signOut] Failed to clear Supabase auth storage:', error);
    }),
  ]);
}

/**
 * End the Clerk session, drop cached role/query/token state, then open login.
 * The in-progress flag stops the root guard from sending the user back into a
 * role dashboard before `isSignedIn` flips.
 */
export async function completeSignOut(signOut: ClerkSignOut): Promise<void> {
  signOutInProgress = true;
  try {
    await signOut();
  } catch (error) {
    signOutInProgress = false;
    throw error;
  }

  await clearLocalSession();

  try {
    router.replace('/(auth)/login');
  } catch (error) {
    console.warn('[signOut] Navigation after sign-out failed:', error);
  }
}
