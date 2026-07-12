/**
 * Read system_settings values. Authenticated clients can select the table
 * directly; signup (anon) uses the get_system_setting RPC.
 */

import { supabase } from './supabase';

const cache = new Map<string, { value: string | null; at: number }>();
const CACHE_MS = 30_000;

export async function getSystemSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  // Prefer direct select (works for authenticated users under RLS).
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (!error && data) {
    const value = (data.value as string | null) ?? null;
    cache.set(key, { value, at: Date.now() });
    return value;
  }

  // Fallback for anon / before session (signup, pre-auth checks).
  const { data: rpcValue, error: rpcError } = await supabase.rpc('get_system_setting', {
    p_key: key,
  });
  if (rpcError) {
    console.warn('[settings] Failed to read', key, rpcError.message);
    return null;
  }
  const value = (rpcValue as string | null) ?? null;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function isPublicSignupAllowed(): Promise<boolean> {
  const value = await getSystemSetting('allow_public_signup');
  // Default open if setting missing so a failed fetch doesn't lock everyone out.
  return value !== 'false';
}

export async function isMaintenanceMode(): Promise<boolean> {
  const value = await getSystemSetting('maintenance_mode');
  return value === 'true';
}

export async function getLowStockThreshold(): Promise<number> {
  const value = await getSystemSetting('low_stock_threshold');
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/** Clear cached settings after an admin update. */
export function invalidateSettingsCache(): void {
  cache.clear();
}
