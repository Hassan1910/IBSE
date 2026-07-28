import { supabase } from './supabase';

export type AccountStatus = 'pending' | 'approved' | 'rejected';

export interface PendingAccount {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  created_at: string;
  account_status: AccountStatus;
}

export async function fetchPendingAccounts(): Promise<PendingAccount[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, created_at, account_status')
    .eq('account_status', 'pending')
    .in('role', ['tenant', 'client'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as PendingAccount[];
}

/** Rejected tenant/client accounts that an admin may re-approve. */
export async function fetchRejectedAccounts(): Promise<PendingAccount[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, created_at, account_status')
    .eq('account_status', 'rejected')
    .in('role', ['tenant', 'client'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as PendingAccount[];
}

export async function countPendingAccounts(): Promise<number> {
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('account_status', 'pending')
    .in('role', ['tenant', 'client']);

  if (error) throw error;
  return count ?? 0;
}

export async function setAccountStatus(
  userId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ account_status: status })
    .eq('id', userId);

  if (error) throw error;
}
