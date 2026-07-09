import { supabase } from './supabase';
import type { UserRole } from '../hooks/useRole';

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

/** Marks an invite as accepted once the profile has been created. */
export async function markInviteAccepted(inviteId: string): Promise<void> {
  try {
    await supabase.from('user_invites').update({ status: 'accepted' }).eq('id', inviteId);
  } catch (err) {
    console.warn('[invites] Failed to mark invite accepted:', err);
  }
}
