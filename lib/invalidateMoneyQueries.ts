import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/queries/keys';
import type { NotificationType } from './notifications';

const MONEY_NOTIFICATION_TYPES = new Set<NotificationType>([
  'payment_confirmed',
  'payment_submitted',
  'deposit_update',
  'purchase_update',
  'rent_due',
]);

const BOOKING_SYNC_TYPES = new Set<string>(['booking_update', ...MONEY_NOTIFICATION_TYPES]);

/** True when a notification type should refresh tenant/client money caches. */
export function isMoneyNotificationType(type: string): boolean {
  return MONEY_NOTIFICATION_TYPES.has(type as NotificationType);
}

/** True when notification should refresh money and/or booking caches. */
export function isMoneyOrBookingNotificationType(type: string): boolean {
  return BOOKING_SYNC_TYPES.has(type);
}

/** Invalidate tenant dashboard, rent, deposits, and lease balance caches. */
export function invalidateTenantMoneyQueries(queryClient: QueryClient, userId: string) {
  if (!userId) return;
  void queryClient.invalidateQueries({ queryKey: queryKeys.tenantDashboard(userId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.clientDeposits(userId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tenantRent(userId) });
  void queryClient.invalidateQueries({ queryKey: ['tenant', 'balance'] });
}

/** Invalidate staff/landlord money queues (safe no-op when unused). */
export function invalidateStaffMoneyQueries(queryClient: QueryClient, userId?: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboardQueues });
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboardStats });
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminFinances });
  if (userId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.landlordPayments(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.landlordAgreements(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.landlordDashboard(userId) });
  }
}

/** Also invalidate client purchases/bookings and staff queues for money events. */
export function invalidateMoneyQueriesForNotification(
  queryClient: QueryClient,
  userId: string,
  type: string,
) {
  if (!userId || !isMoneyOrBookingNotificationType(type)) return;

  invalidateTenantMoneyQueries(queryClient, userId);
  invalidateStaffMoneyQueries(queryClient, userId);

  if (type === 'purchase_update') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.clientPurchases(userId) });
  }
  if (type === 'booking_update' || type === 'deposit_update') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.clientBookings(userId) });
  }
}
