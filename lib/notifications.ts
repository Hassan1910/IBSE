import { supabase } from './supabase';

export type NotificationType =
  | 'rent_due'
  | 'payment_confirmed'
  | 'maintenance_update'
  | 'lease_expiry'
  | 'announcement'
  | 'feedback_reply'
  | 'booking_update';

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
  return supabase.from('notifications').insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
  });
}
