import { supabase } from './supabase';
import { dispatchPush } from './push';

export type NotificationType =
  | 'rent_due'
  | 'payment_confirmed'
  | 'payment_submitted'
  | 'maintenance_update'
  | 'lease_expiry'
  | 'announcement'
  | 'feedback_reply'
  | 'booking_update'
  | 'message'
  | 'landlord_request'
  | 'purchase_update'
  | 'account_approval'
  | 'deposit_update';

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export async function fetchNotifications(userId: string) {
  return supabase
    .from('notifications')
    .select('id, user_id, type, title, body, entity_type, entity_id, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}

export async function markNotificationAsRead(notificationId: string) {
  return supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
}

export async function markAllNotificationsAsRead(userId: string) {
  return supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
}

export async function getUnreadCount(userId: string) {
  return supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
}

export interface NotifyUserInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

export async function notifyUser(input: NotifyUserInput) {
  const { data, error } = await supabase.from('notifications').insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
  });
  if (error) throw error;
  void dispatchPush({
    userId: input.userId,
    title: input.title,
    body: input.body,
    data: {
      type: input.type,
      entityType: input.entityType || '',
      entityId: input.entityId || '',
    },
  });
  return { data, error: null };
}

export type StaffNotifyRole = 'admin' | 'finance';

/** Notify staff profiles (SECURITY DEFINER RPC; usable by clients). Defaults to admin + finance. */
export async function notifyAdmins(
  input: Omit<NotifyUserInput, 'userId'> & { roles?: StaffNotifyRole[] },
) {
  const roles: StaffNotifyRole[] = input.roles?.length ? input.roles : ['admin', 'finance'];
  const { error } = await supabase.rpc('notify_admins', {
    p_type: input.type,
    p_title: input.title,
    p_body: input.body,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_roles: roles,
  });
  if (error) throw error;

  try {
    const { data: staff } = await supabase.from('profiles').select('id').in('role', roles);
    const userIds = (staff || []).map((a) => a.id);
    if (userIds.length) {
      void dispatchPush({
        userIds,
        title: input.title,
        body: input.body,
        data: {
          type: input.type,
          entityType: input.entityType || '',
          entityId: input.entityId || '',
        },
      });
    }
  } catch {
    // Push is best-effort; RLS may block client listing staff — that's ok.
  }
  return { data: null, error: null };
}

/** Notify the landlord who owns a property (or admins when owner_id is null). */
export async function notifyPropertyOwner(input: {
  propertyId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}) {
  const { error } = await supabase.rpc('notify_for_property', {
    p_property_id: input.propertyId,
    p_type: input.type,
    p_title: input.title,
    p_body: input.body,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
  });
  if (error) throw error;

  try {
    const { data: prop } = await supabase
      .from('properties')
      .select('owner_id')
      .eq('id', input.propertyId)
      .maybeSingle();
    if (prop?.owner_id) {
      void dispatchPush({
        userId: prop.owner_id,
        title: input.title,
        body: input.body,
        data: {
          type: input.type,
          entityType: input.entityType || '',
          entityId: input.entityId || '',
        },
      });
    }
  } catch {
    // best-effort
  }
  return { data: null, error: null };
}
