import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import {
  invalidateMoneyQueriesForNotification,
  isMoneyOrBookingNotificationType,
} from './invalidateMoneyQueries';
import { getNotificationRoute, type NotificationRole } from './notificationRoutes';
import type { AppNotification } from './notifications';

type UnreadListener = () => void;
type ListListener = () => void;
type RoleGetter = () => NotificationRole | null;

let activeUserId: string | null = null;
let channel: RealtimeChannel | null = null;
let queryClientRef: QueryClient | null = null;
const unreadListeners = new Set<UnreadListener>();
const listListeners = new Set<ListListener>();
let pushSubscription: Notifications.EventSubscription | null = null;
let pushResponseSubscription: Notifications.EventSubscription | null = null;
let roleGetter: RoleGetter | null = null;
let navigateHandler: ((target: ReturnType<typeof getNotificationRoute>) => void) | null = null;

function notifyUnreadListeners() {
  for (const listener of unreadListeners) {
    listener();
  }
}

function notifyListListeners() {
  for (const listener of listListeners) {
    listener();
  }
}

function handleMoneyType(userId: string, type: string) {
  if (!queryClientRef || !isMoneyOrBookingNotificationType(type)) return;
  invalidateMoneyQueriesForNotification(queryClientRef, userId, type);
}

function ensurePushListener() {
  if (Platform.OS === 'web') return;
  if (!pushSubscription) {
    pushSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const type = notification.request.content.data?.type;
      const userId = activeUserId;
      if (userId && typeof type === 'string') {
        handleMoneyType(userId, type);
      }
      notifyUnreadListeners();
      notifyListListeners();
    });
  }

  if (!pushResponseSubscription) {
    pushResponseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (!data || !roleGetter || !navigateHandler) return;
      const role = roleGetter();
      if (!role) return;
      const item = {
        id: String(data.notificationId || data.id || ''),
        user_id: activeUserId || '',
        type: String(data.type || ''),
        title: response.notification.request.content.title || '',
        body: response.notification.request.content.body || '',
        entity_type: data.entityType ? String(data.entityType) : null,
        entity_id: data.entityId ? String(data.entityId) : null,
        read_at: null,
        created_at: new Date().toISOString(),
      } as AppNotification;
      const target = getNotificationRoute(role, item);
      if (target) navigateHandler(target);
    });
  }
}

function teardownPushListener() {
  pushSubscription?.remove();
  pushSubscription = null;
  pushResponseSubscription?.remove();
  pushResponseSubscription = null;
}

function ensureChannel(userId: string) {
  if (channel && activeUserId === userId) return;

  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }

  activeUserId = userId;
  channel = supabase
    .channel(`user-notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as { type?: string } | null;
        const type = row?.type;
        if (typeof type === 'string') {
          handleMoneyType(userId, type);
        }
        notifyUnreadListeners();
        notifyListListeners();
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      () => {
        notifyUnreadListeners();
        notifyListListeners();
      },
    )
    .subscribe();

  ensurePushListener();
}

function maybeTeardown() {
  if (unreadListeners.size > 0 || listListeners.size > 0) return;
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  activeUserId = null;
  queryClientRef = null;
  teardownPushListener();
}

/**
 * Shared notifications realtime + foreground push listener.
 * Multiple callers share one channel; unread listeners are fan-out.
 */
export function subscribeNotificationMoneySync(
  userId: string,
  queryClient: QueryClient,
  onUnreadChange: UnreadListener,
): () => void {
  if (!userId) {
    return () => undefined;
  }

  queryClientRef = queryClient;
  unreadListeners.add(onUnreadChange);
  ensureChannel(userId);

  return () => {
    unreadListeners.delete(onUnreadChange);
    maybeTeardown();
  };
}

/** Subscribe to notification list refresh (INSERT/UPDATE). */
export function subscribeNotificationListSync(userId: string, onChange: ListListener): () => void {
  if (!userId) return () => undefined;
  listListeners.add(onChange);
  ensureChannel(userId);
  return () => {
    listListeners.delete(onChange);
    maybeTeardown();
  };
}

/** Wire push-tap navigation (call once from root with role + router). */
export function setNotificationPushNavigation(
  getRole: RoleGetter,
  navigate: (target: ReturnType<typeof getNotificationRoute>) => void,
) {
  roleGetter = getRole;
  navigateHandler = navigate;
  ensurePushListener();
}
