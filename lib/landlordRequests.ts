import { supabase } from './supabase';

export type LandlordRequestStatus = 'pending' | 'fulfilled' | 'dismissed';

export interface LandlordAccountRequest {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  note: string | null;
  status: LandlordRequestStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export async function submitLandlordAccountRequest(params: {
  fullName: string;
  email: string;
  phone: string;
  note?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('submit_landlord_account_request', {
    p_full_name: params.fullName.trim(),
    p_email: params.email.trim(),
    p_phone: params.phone.trim(),
    p_note: params.note?.trim() || null,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchPendingLandlordRequests(): Promise<LandlordAccountRequest[]> {
  const { data, error } = await supabase
    .from('landlord_account_requests')
    .select('id, full_name, email, phone, note, status, created_at, resolved_at, resolved_by')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as LandlordAccountRequest[]) || [];
}

export async function resolveLandlordRequest(
  requestId: string,
  status: 'fulfilled' | 'dismissed',
  resolvedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('landlord_account_requests')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq('id', requestId)
    .eq('status', 'pending');
  if (error) throw error;
}
