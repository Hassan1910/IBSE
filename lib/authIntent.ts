import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_INTENT_KEY = 'ibse:pendingAuthIntent';

export type AuthIntentAction = 'deposit' | 'purchase';

export type AuthIntent = {
  action: AuthIntentAction;
  propertyId: string;
};

/** Process-local hold so tenants/clients are not bounced mid-payment after AsyncStorage intent is cleared. */
let paymentResumeHold = false;

export function setPaymentResumeHold(held: boolean): void {
  paymentResumeHold = held;
}

export function isPaymentResumeHeld(): boolean {
  return paymentResumeHold;
}

function isAuthIntent(value: unknown): value is AuthIntent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.action === 'deposit' || v.action === 'purchase') &&
    typeof v.propertyId === 'string' &&
    v.propertyId.length > 0
  );
}

export async function setAuthIntent(intent: AuthIntent): Promise<void> {
  await AsyncStorage.setItem(AUTH_INTENT_KEY, JSON.stringify(intent));
}

export async function getAuthIntent(): Promise<AuthIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_INTENT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAuthIntent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearAuthIntent(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_INTENT_KEY);
}
