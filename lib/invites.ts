import { supabase } from './supabase';
import type { UserRole } from '../hooks/useRole';

export type InviteRole = Exclude<UserRole, 'landlord'>;

/**
 * Looks up a pending admin-created invite for the given email. Admins can
 * pre-register users (email + role); when that person signs up or first logs
 * in, we apply the invited role instead of the default 'client'.
 *
 * Returns the invited role and the invite id (so it can be marked accepted),
 * or null when there is no usable invite.
 */
export async function resolveInvite(
  email: string,
): Promise<{ role: UserRole; inviteId: string; fullName: string | null } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  try {
    const { data, error } = await supabase
      .from('user_invites')
      .select('id, role, full_name, status')
      .eq('email', normalized)
      .eq('status', 'pending')
      .maybeSingle();

    if (error || !data) return null;

    return {
      role: data.role as UserRole,
      inviteId: data.id as string,
      fullName: (data.full_name as string | null) ?? null,
    };
  } catch (err) {
    console.warn('[invites] Failed to resolve invite:', err);
    return null;
  }
}

/** Pre-auth check via SECURITY DEFINER RPC (works for anon signup gating). */
export async function hasPendingInvite(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const { data, error } = await supabase.rpc('get_pending_invite_role', {
    p_email: normalized,
  });
  if (error) {
    console.warn('[invites] Failed pending-invite check:', error.message);
    return false;
  }
  return typeof data === 'string' && data.length > 0;
}

/** Marks an invite as accepted once the profile has been created. */
export async function markInviteAccepted(inviteId: string): Promise<void> {
  try {
    const { error: rpcError } = await supabase.rpc('accept_invite', { p_invite_id: inviteId });
    if (!rpcError) return;
    // Fallback for environments that have not applied the accept_invite RPC yet.
    await supabase.from('user_invites').update({ status: 'accepted' }).eq('id', inviteId);
  } catch (err) {
    console.warn('[invites] Failed to mark invite accepted:', err);
  }
}

/** Admin creates a pending invite so the person can self-register with that role. */
export async function createInvite(params: {
  email: string;
  role: InviteRole;
  fullName?: string | null;
  invitedBy?: string | null;
}): Promise<void> {
  const email = params.email.trim().toLowerCase();
  if (!email) throw new Error('Email is required.');

  const { error } = await supabase.from('user_invites').insert({
    email,
    role: params.role,
    full_name: params.fullName?.trim() || null,
    invited_by: params.invitedBy ?? null,
    status: 'pending',
  });
  if (error) {
    if (error.code === '23505') {
      throw new Error('An invite for this email already exists.');
    }
    throw error;
  }
}
