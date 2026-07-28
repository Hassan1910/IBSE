import { supabase } from '../../lib/supabase';
import { PAGE_SIZE } from '../../lib/queryClient';

export type AdminDashboardStats = {
  total_revenue: number;
  active_leases: number;
  pending_bookings: number;
  open_maintenance: number;
};

export type AdminReportSummary = {
  property: {
    total: number;
    available: number;
    reserved?: number;
    rented: number;
    sold: number;
    residential: number;
    commercial: number;
    land: number;
    rental_units: number;
  };
  financial: {
    rent_revenue: number;
    purchase_revenue: number;
    verified_revenue: number;
    pending_amount: number;
    pending_rent: number;
    pending_purchases: number;
    deposits_held?: number;
    deposits_refunded?: number;
    deposits_retained?: number;
    deposits_pending?: number;
    total_expenses: number;
    payments_count: number;
    purchases_count: number;
  };
  occupancy: {
    active_leases: number;
    open_maintenance: number;
  };
  users: {
    total: number;
    admin: number;
    finance: number;
    landlord: number;
    tenant: number;
    client: number;
    new_30_days: number;
  };
};

export type LandlordDashboardStats = {
  total_properties: number;
  occupied_units: number;
  vacant_units: number;
  total_tenants: number;
  monthly_income: number;
  verified_collected: number;
  pending_payments: number;
};

const PROPERTY_CARD_COLS =
  'id, title, description, type, category, price, location, status, image_urls, created_at, owner_id';

export async function fetchAdminDashboardStats(): Promise<AdminDashboardStats> {
  const { data, error } = await supabase.rpc('admin_dashboard_stats');
  if (error) throw error;
  return data as AdminDashboardStats;
}

export async function fetchAdminReportSummary(
  from?: string | null,
  to?: string | null
): Promise<AdminReportSummary> {
  const { data, error } = await supabase.rpc('admin_report_summary', {
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) throw error;
  return data as AdminReportSummary;
}

export async function fetchLandlordDashboardStats(
  ownerId: string
): Promise<LandlordDashboardStats> {
  const { data, error } = await supabase.rpc('landlord_dashboard_stats', {
    p_owner_id: ownerId,
  });
  if (error) throw error;
  return data as LandlordDashboardStats;
}

export async function fetchVerifiedRevenueSum(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_verified_revenue');
  if (error) throw error;
  return Number(data ?? 0);
}

export type AdminRevenueBreakdown = {
  rent_revenue: number;
  purchase_revenue: number;
  total_revenue: number;
};

export async function fetchRevenueBreakdown(): Promise<AdminRevenueBreakdown> {
  const { data, error } = await supabase.rpc('admin_revenue_breakdown');
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    rent_revenue: Number(row.rent_revenue ?? 0),
    purchase_revenue: Number(row.purchase_revenue ?? 0),
    total_revenue: Number(row.total_revenue ?? 0),
  };
}

export async function fetchTotalExpensesSum(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_total_expenses');
  if (error) throw error;
  return Number(data ?? 0);
}

export async function fetchAvailablePropertyById(propertyId: string) {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_CARD_COLS)
    .eq('id', propertyId)
    .eq('status', 'available')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchAvailablePropertiesPage(
  category: string,
  page: number,
  /** Lowercase DB categories; when set, "All" uses `.in` instead of no filter. */
  allowedCategories?: string[]
) {
  const from = page * PAGE_SIZE.properties;
  const to = from + PAGE_SIZE.properties - 1;
  let query = supabase
    .from('properties')
    .select(PROPERTY_CARD_COLS)
    .eq('status', 'available')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (category !== 'All') {
    query = query.eq('category', category.toLowerCase());
  } else if (allowedCategories && allowedCategories.length > 0) {
    query = query.in('category', allowedCategories);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchAdminPropertiesPage(page: number) {
  const from = page * PAGE_SIZE.properties;
  const to = from + PAGE_SIZE.properties - 1;
  const { data, error } = await supabase
    .from('properties')
    .select(`${PROPERTY_CARD_COLS}, profiles:owner_id ( full_name )`)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data || [];
}

export async function fetchLandlordPropertiesPage(ownerId: string, page: number) {
  const from = page * PAGE_SIZE.properties;
  const to = from + PAGE_SIZE.properties - 1;
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_CARD_COLS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data || [];
}

export async function fetchLandlordPaymentsPage(ownerId: string, page: number) {
  const from = page * PAGE_SIZE.tables;
  const to = from + PAGE_SIZE.tables - 1;
  const { data, error } = await supabase
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
      leases!inner (
        properties!inner ( title, owner_id )
      )
    `
    )
    .eq('leases.properties.owner_id', ownerId)
    .order('payment_date', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data || [];
}

export async function fetchLandlordMaintenancePage(ownerId: string, page: number) {
  const from = page * PAGE_SIZE.tables;
  const to = from + PAGE_SIZE.tables - 1;
  const { data, error } = await supabase
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
      assigned_to,
      expense_amount,
      image_urls,
      properties!inner ( title, owner_id ),
      profiles:tenant_id ( full_name )
    `
    )
    .eq('properties.owner_id', ownerId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data || [];
}

export async function fetchTenantMaintenance(userId: string) {
  const [leaseRes, ticketsRes] = await Promise.all([
    supabase
      .from('leases')
      .select('property_id, properties(title)')
      .eq('tenant_id', userId)
      .in('status', ['pending', 'active'])
      .order('status', { ascending: true })
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('maintenance_requests')
      .select(
        'id, title, description, priority, status, image_urls, tenant_confirmed_at, assigned_to, expense_amount, created_at, properties ( title )'
      )
      .eq('tenant_id', userId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE.tables),
  ]);
  if (leaseRes.error) throw leaseRes.error;
  if (ticketsRes.error) throw ticketsRes.error;
  return {
    lease: leaseRes.data,
    requests: ticketsRes.data || [],
  };
}

export async function fetchTenantDashboard(userId: string) {
  const [leaseRes, payRes, maintRes] = await Promise.all([
    supabase
      .from('leases')
      .select(
        `
        id,
        start_date,
        end_date,
        rent_amount,
        status,
        contract_url,
        terms,
        unit_id,
        properties ( title, location ),
        units ( unit_number )
      `
      )
      .eq('tenant_id', userId)
      .in('status', ['pending', 'active'])
      .order('start_date', { ascending: false }),
    supabase
      .from('payments')
      .select('id, amount, payment_date, payment_method, reference_code, status, lease_id')
      .eq('payer_id', userId)
      .order('payment_date', { ascending: false })
      .limit(PAGE_SIZE.tables),
    supabase
      .from('maintenance_requests')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', userId)
      .neq('status', 'resolved'),
  ]);
  if (leaseRes.error) throw leaseRes.error;
  if (payRes.error) throw payRes.error;
  if (maintRes.error) throw maintRes.error;
  return {
    leases: leaseRes.data || [],
    payments: payRes.data || [],
    openMaintenance: maintRes.count || 0,
  };
}

export async function fetchAdminUsersPage(page: number) {
  const from = page * PAGE_SIZE.tables;
  const to = from + PAGE_SIZE.tables - 1;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, created_at, avatar_url, account_status')
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data || [];
}

export async function fetchExpensesPage(page: number) {
  const from = page * PAGE_SIZE.tables;
  const to = from + PAGE_SIZE.tables - 1;
  const { data, error } = await supabase
    .from('expenses')
    .select('id, category, description, amount, incurred_on')
    .order('incurred_on', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data || [];
}

export async function fetchSupportPage(
  page: number,
  status: 'open' | 'resolved' | 'all' = 'all'
) {
  const from = page * PAGE_SIZE.tables;
  const to = from + PAGE_SIZE.tables - 1;
  let query = supabase
    .from('feedback')
    .select(
      'id, user_id, type, message, status, admin_reply, replied_at, created_at, profiles!feedback_user_id_fkey ( full_name, email )'
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchInventoryPage(page: number) {
  const from = page * PAGE_SIZE.tables;
  const to = from + PAGE_SIZE.tables - 1;
  const { data, error } = await supabase
    .from('inventory')
    .select('id, item_name, quantity, unit, status, updated_at')
    .order('item_name', { ascending: true })
    .range(from, to);
  if (error) throw error;
  return data || [];
}
