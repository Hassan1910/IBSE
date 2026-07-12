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
      }
      // Fallbacks when entity_type is missing or announcement
      if (type === 'announcement' || type === 'lease_expiry') {
        return '/(tenant)/dashboard' as Href;
      }
      if (type === 'message') {
        return withId('/(tenant)/messages', id);
      }
      if (type === 'rent_due' || type === 'payment_confirmed' || type === 'payment_submitted') {
        return withId('/(tenant)/rent', id);
      }
      if (type === 'maintenance_update') {
        return withId('/(tenant)/maintenance', id);
      }
      if (type === 'feedback_reply') {
        return withId('/(tenant)/feedback', id);
      }
      return '/(tenant)/dashboard' as Href;
    }

    case 'client': {
      switch (entityType) {
        case 'booking':
          return withId('/(client)/my-bookings', id);
        case 'feedback':
          return withId('/(client)/feedback', id);
      }
      if (type === 'booking_update') {
        return withId('/(client)/my-bookings', id);
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
        default:
          if (type === 'message') return withId('/(landlord)/messages', id);
          if (type === 'announcement') return '/(landlord)/dashboard' as Href;
          return null;
      }

    case 'admin': {
      if (entityType === 'feedback') return withId('/(admin)/support', id);
      if (entityType === 'lease') return withId('/(admin)/users', id);
      if (entityType === 'landlord_account_request' || type === 'landlord_request') {
        return '/(admin)/users' as Href;
      }

      const dashboardTab =
        entityType === 'maintenance'
          ? 'maintenance'
          : entityType === 'payment'
            ? 'payments'
            : entityType === 'booking'
              ? 'bookings'
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
      // Finance only has dashboard (payments), reports, finances, profile.
      if (entityType === 'payment' || type === 'payment_confirmed' || type === 'payment_submitted' || type === 'rent_due') {
        return {
          pathname: '/(admin)/dashboard',
          params: {
            tab: 'payments',
            ...(id ? { id } : {}),
          },
        };
      }
      return '/(admin)/finances' as Href;
    }

    default:
      return null;
  }
}
