import type { Href } from 'expo-router';
import type { AppNotification } from './notifications';

export type NotificationRole = 'tenant' | 'client' | 'landlord' | 'admin' | 'finance';

type RouteTarget = Href | { pathname: string; params?: Record<string, string> };

function withId(pathname: string, id?: string | null): RouteTarget {
  if (!id) return pathname as Href;
  return { pathname, params: { id } };
}

/** Resolve where a notification should navigate for a given app role. */
export function getNotificationRoute(
  role: NotificationRole,
  item: AppNotification,
): RouteTarget | null {
  const id = item.entity_id;
  const entityType = item.entity_type;
  const type = item.type;

  switch (role) {
    case 'tenant': {
      // Prefer type for rent_due — scheduled alerts set entity_type=lease.
      if (type === 'rent_due') {
        return withId('/(tenant)/rent', id);
      }
      switch (entityType) {
        case 'maintenance':
          return withId('/(tenant)/maintenance', id);
        case 'payment':
          return withId('/(tenant)/rent', id);
        case 'feedback':
          return withId('/(tenant)/feedback', id);
        case 'lease':
          return withId('/(tenant)/agreements', id);
        case 'message_thread':
          return withId('/(tenant)/messages', id);
        case 'deposit':
          return '/(tenant)/dashboard' as Href;
      }
      // Fallbacks when entity_type is missing or announcement
      if (type === 'announcement' || type === 'lease_expiry') {
        return '/(tenant)/dashboard' as Href;
      }
      if (type === 'message') {
        return withId('/(tenant)/messages', id);
      }
      if (type === 'payment_confirmed' || type === 'payment_submitted') {
        return withId('/(tenant)/rent', id);
      }
      if (type === 'maintenance_update') {
        return withId('/(tenant)/maintenance', id);
      }
      if (type === 'feedback_reply') {
        return withId('/(tenant)/feedback', id);
      }
      if (type === 'deposit_update') {
        return '/(tenant)/dashboard' as Href;
      }
      return '/(tenant)/dashboard' as Href;
    }

    case 'client': {
      switch (entityType) {
        case 'booking':
          return withId('/(client)/my-bookings', id);
        case 'feedback':
          return withId('/(client)/feedback', id);
        case 'purchase':
          return withId('/(client)/my-purchases', id);
        case 'deposit':
          return withId('/(client)/my-bookings', id);
        case 'lease':
          return '/(client)/my-bookings' as Href;
      }
      if (type === 'booking_update' || type === 'deposit_update') {
        return withId('/(client)/my-bookings', id);
      }
      if (type === 'purchase_update') {
        return withId('/(client)/my-purchases', id);
      }
      if (type === 'feedback_reply') {
        return withId('/(client)/feedback', id);
      }
      if (type === 'announcement') return '/(client)/properties' as Href;
      return '/(client)/properties' as Href;
    }

    case 'landlord':
      switch (entityType) {
        case 'maintenance':
          return withId('/(landlord)/maintenance', id);
        case 'payment':
          return withId('/(landlord)/payments', id);
        case 'lease':
          return withId('/(landlord)/agreements', id);
        case 'message_thread':
          return withId('/(landlord)/messages', id);
        case 'deposit':
          return '/(landlord)/agreements' as Href;
        case 'purchase':
          return '/(landlord)/properties' as Href;
        default:
          if (type === 'message') return withId('/(landlord)/messages', id);
          if (type === 'deposit_update') return '/(landlord)/agreements' as Href;
          if (type === 'purchase_update') return '/(landlord)/properties' as Href;
          if (type === 'announcement') return '/(landlord)/dashboard' as Href;
          return null;
      }

    case 'admin': {
      if (entityType === 'feedback') return withId('/(admin)/support', id);
      if (entityType === 'lease') return withId('/(admin)/users', id);
      if (entityType === 'landlord_account_request' || type === 'landlord_request') {
        return '/(admin)/users' as Href;
      }
      if (entityType === 'profile' || type === 'account_approval') {
        return '/(admin)/users' as Href;
      }

      const dashboardTab =
        entityType === 'maintenance'
          ? 'maintenance'
          : entityType === 'payment'
            ? 'payments'
            : entityType === 'booking'
              ? 'bookings'
              : entityType === 'deposit' || type === 'deposit_update'
                ? 'deposits'
                : entityType === 'purchase' || type === 'purchase_update'
                  ? 'purchases'
                  : null;

      if (dashboardTab) {
        return {
          pathname: '/(admin)/dashboard',
          params: {
            tab: dashboardTab,
            ...(id ? { id } : {}),
          },
        };
      }
      if (type === 'announcement') return '/(admin)/dashboard' as Href;
      return null;
    }

    case 'finance': {
      // Finance only has dashboard (payments/purchases), reports, finances, profile.
      // Account approval is admin-only — no route (UI shows a clear alert).
      if (entityType === 'profile' || type === 'account_approval') {
        return null;
      }
      if (entityType === 'purchase' || type === 'purchase_update') {
        return {
          pathname: '/(admin)/dashboard',
          params: {
            tab: 'purchases',
            ...(id ? { id } : {}),
          },
        };
      }
      if (entityType === 'deposit' || type === 'deposit_update') {
        return {
          pathname: '/(admin)/dashboard',
          params: {
            tab: 'deposits',
            ...(id ? { id } : {}),
          },
        };
      }
      if (entityType === 'payment' || type === 'payment_confirmed' || type === 'payment_submitted' || type === 'rent_due') {
        return {
          pathname: '/(admin)/dashboard',
          params: {
            tab: 'payments',
            ...(id ? { id } : {}),
          },
        };
      }
      // Ops notifications (bookings/maintenance/feedback) are admin-owned — send to money home.
      if (
        entityType === 'booking' ||
        entityType === 'maintenance' ||
        entityType === 'feedback' ||
        type === 'booking_update' ||
        type === 'maintenance_update' ||
        type === 'feedback_reply'
      ) {
        return '/(admin)/dashboard' as Href;
      }
      return '/(admin)/finances' as Href;
    }

    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}
