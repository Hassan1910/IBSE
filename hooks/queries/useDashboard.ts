import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PAGE_SIZE } from '../../lib/queryClient';
import { queryKeys } from './keys';
import {
  fetchAdminDashboardStats,
  fetchAdminReportSummary,
  fetchLandlordDashboardStats,
  fetchVerifiedRevenueSum,
  fetchExpensesPage,
} from './fetchers';

export function useAdminDashboardStats(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminDashboardStats,
    queryFn: fetchAdminDashboardStats,
    enabled,
  });
}

export async function fetchAdminDashboardQueues(includeOps: boolean) {
  const payPromise = supabase
    .from('payments')
    .select(
      `
      id,
      payer_id,
      amount,
      payment_method,
      reference_code,
      payment_date,
      status,
      proof_url,
      receipt_url,
      profiles:payer_id ( full_name, email ),
      leases (
        properties ( title )
      )
    `
    )
    .eq('status', 'pending')
    .order('payment_date', { ascending: true })
    .limit(PAGE_SIZE.queues);

  const purchasePromise = supabase
    .from('property_purchases')
    .select(
      `
      id,
      property_id,
      buyer_id,
      amount,
      payment_method,
      reference_code,
      proof_url,
      status,
      notes,
      verified_by,
      verified_at,
      created_at,
      profiles:buyer_id ( full_name, email, phone ),
      properties ( title, location, price, status ),
      purchase_documents ( id, purchase_id, doc_type, title, file_url, uploaded_by, created_at )
    `
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(PAGE_SIZE.queues);

  const depositSelect = `
      id,
      property_id,
      client_id,
      booking_id,
      lease_id,
      amount,
      payment_method,
      reference_code,
      proof_url,
      status,
      notes,
      verified_by,
      verified_at,
      created_at,
      profiles:client_id ( full_name, email, phone ),
      properties ( title, location, price, status, type, owner_id )
    `;

  const pendingDepositPromise = supabase
    .from('deposit_payments')
    .select(depositSelect)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(PAGE_SIZE.queues);

  /** Verified deposits not yet linked to a lease — admin can Create Lease without a viewing. */
  const readyDepositPromise = supabase
    .from('deposit_payments')
    .select(depositSelect)
    .eq('status', 'verified')
    .is('lease_id', null)
    .order('verified_at', { ascending: true })
    .limit(PAGE_SIZE.queues);

  if (!includeOps) {
    // Finance needs pending (verify) + verified/unlinked (release) deposits.
    const [payRes, purchaseRes, pendingDepRes, readyDepRes] = await Promise.all([
      payPromise,
      purchasePromise,
      pendingDepositPromise,
      readyDepositPromise,
    ]);
    if (payRes.error) throw payRes.error;
    if (purchaseRes.error) throw purchaseRes.error;
    if (pendingDepRes.error) throw pendingDepRes.error;
    if (readyDepRes.error) throw readyDepRes.error;
    return {
      payments: payRes.data || [],
      purchases: purchaseRes.data || [],
      deposits: [...(pendingDepRes.data || []), ...(readyDepRes.data || [])],
      bookings: [] as any[],
      maintenance: [] as any[],
      feedback: [] as any[],
    };
  }

  const [payRes, purchaseRes, pendingDepRes, readyDepRes, bookRes, maintRes, feedRes] =
    await Promise.all([
      payPromise,
      purchasePromise,
      pendingDepositPromise,
      readyDepositPromise,
      supabase
        .from('bookings')
        .select(
          `
        id,
        client_id,
        property_id,
        booking_date,
        type,
        status,
        notes,
        properties ( title, location, type, owner_id, price ),
        profiles ( full_name, email, phone )
      `
        )
        .in('status', ['pending', 'approved'])
        .order('booking_date', { ascending: true })
        .limit(PAGE_SIZE.queues),
      supabase
        .from('maintenance_requests')
        .select(
          `
        id,
        tenant_id,
        title,
        description,
        priority,
        status,
        created_at,
        image_urls,
        properties ( title ),
        profiles ( full_name )
      `
        )
        .neq('status', 'resolved')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE.queues),
      supabase
        .from('feedback')
        .select(
          `
        id,
        type,
        message,
        created_at,
        profiles!feedback_user_id_fkey ( full_name, email )
      `
        )
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE.queues),
    ]);

  if (payRes.error) throw payRes.error;
  if (purchaseRes.error) throw purchaseRes.error;
  if (pendingDepRes.error) throw pendingDepRes.error;
  if (readyDepRes.error) throw readyDepRes.error;
  if (bookRes.error) throw bookRes.error;
  if (maintRes.error) throw maintRes.error;
  if (feedRes.error) throw feedRes.error;

  const deposits = [...(pendingDepRes.data || []), ...(readyDepRes.data || [])];

  return {
    payments: payRes.data || [],
    purchases: purchaseRes.data || [],
    deposits,
    bookings: bookRes.data || [],
    maintenance: maintRes.data || [],
    feedback: feedRes.data || [],
  };
}

export function useAdminDashboardQueues(includeOps: boolean, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.adminDashboardQueues, includeOps],
    queryFn: () => fetchAdminDashboardQueues(includeOps),
    enabled,
  });
}

export function useAdminReportSummary(from?: string | null, to?: string | null) {
  return useQuery({
    queryKey: queryKeys.adminReportSummary(from, to),
    queryFn: () => fetchAdminReportSummary(from, to),
  });
}

export function useAdminFinances(page = 0) {
  const revenueQuery = useQuery({
    queryKey: [...queryKeys.adminFinances, 'revenue'],
    queryFn: fetchVerifiedRevenueSum,
  });
  const expensesQuery = useQuery({
    queryKey: [...queryKeys.adminFinances, 'expenses', page],
    queryFn: () => fetchExpensesPage(page),
  });
  return { revenueQuery, expensesQuery };
}

export function useLandlordDashboard(userId: string | undefined) {
  const enabled = !!userId;

  const statsQuery = useQuery({
    queryKey: queryKeys.landlordDashboard(userId || ''),
    queryFn: () => fetchLandlordDashboardStats(userId!),
    enabled,
  });

  const recentQuery = useQuery({
    queryKey: [...queryKeys.landlordDashboard(userId || ''), 'recent'],
    queryFn: async () => {
      type RecentPaymentRow = {
        id: string;
        amount: number;
        status: string;
        payment_date: string;
        lease_id: string | null;
        profiles: { full_name: string } | null;
      };
      type RecentRequestRow = {
        id: string;
        title: string;
        status: string;
        created_at: string;
        properties: { title: string } | null;
      };

      const [{ data: pay, error: payError }, { data: reqs, error: reqsError }] =
        await Promise.all([
          supabase
            .from('payments')
            .select(
              `
              id,
              amount,
              status,
              payment_date,
              lease_id,
              profiles:payer_id ( full_name ),
              leases!inner (
                properties!inner ( owner_id )
              )
            `
            )
            .eq('leases.properties.owner_id', userId!)
            .order('payment_date', { ascending: false })
            .limit(5),
          supabase
            .from('maintenance_requests')
            .select('id, title, status, created_at, properties!inner ( title, owner_id )')
            .eq('properties.owner_id', userId!)
            .order('created_at', { ascending: false })
            .limit(5),
        ]);
      if (payError) throw payError;
      if (reqsError) throw reqsError;

      const asOne = <T,>(value: T | T[] | null | undefined): T | null => {
        if (value == null) return null;
        return Array.isArray(value) ? value[0] ?? null : value;
      };

      const recentPayments: RecentPaymentRow[] = (pay || []).map((row) => ({
        id: row.id,
        amount: row.amount,
        status: row.status,
        payment_date: row.payment_date,
        lease_id: row.lease_id,
        profiles: asOne(row.profiles as { full_name: string } | { full_name: string }[] | null),
      }));

      const recentRequests: RecentRequestRow[] = (reqs || []).map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        created_at: row.created_at,
        properties: asOne(
          row.properties as { title: string } | { title: string }[] | null
        ),
      }));

      return {
        recentPayments,
        recentRequests,
      };
    },
    enabled,
  });

  return { statsQuery, recentQuery };
}
