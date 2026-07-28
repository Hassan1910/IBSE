import { supabase } from './supabase';

type OverlapCheckParams = {
  propertyId: string;
  unitId?: string | null;
  startDate: string;
  endDate: string;
  excludeLeaseId?: string;
};

/** Full calendar months between YYYY-MM-DD lease dates (minimum 1). */
export function leaseMonthCount(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (![sy, sm, sd, ey, em, ed].every((n) => Number.isFinite(n))) return 1;

  let months = (ey - sy) * 12 + (em - sm);
  if (ed < sd) months -= 1;
  return Math.max(1, months);
}

/** Total rent owed for the lease term (monthly rate × month count). */
export function leaseTotalRent(monthlyRent: number, startDate: string, endDate: string): number {
  return Number(monthlyRent || 0) * leaseMonthCount(startDate, endDate);
}

export type LeaseBalance = {
  charges_total: number;
  paid_total: number;
  outstanding: number;
  deposit_amount: number;
  deposit_status: string;
};

/** Charges − verified payments for a lease (server RPC). */
export async function fetchLeaseBalance(leaseId: string): Promise<LeaseBalance> {
  const { data, error } = await supabase.rpc('lease_balance', { p_lease_id: leaseId });
  if (error) throw error;
  const row = (data || {}) as Record<string, unknown>;
  return {
    charges_total: Number(row.charges_total ?? 0),
    paid_total: Number(row.paid_total ?? 0),
    outstanding: Number(row.outstanding ?? 0),
    deposit_amount: Number(row.deposit_amount ?? 0),
    deposit_status: String(row.deposit_status ?? 'none'),
  };
}

/**
 * Returns true when another pending/active lease overlaps the given
 * unit (or whole-property rental when unitId is empty).
 */
export async function hasOverlappingLease(params: OverlapCheckParams): Promise<boolean> {
  const { propertyId, unitId, startDate, endDate, excludeLeaseId } = params;

  let query = supabase
    .from('leases')
    .select('id')
    .in('status', ['pending', 'active'])
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .limit(1);

  if (unitId) {
    query = query.eq('unit_id', unitId);
  } else {
    query = query.eq('property_id', propertyId).is('unit_id', null);
  }

  if (excludeLeaseId) {
    query = query.neq('id', excludeLeaseId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export function leaseAssignErrorMessage(err: unknown): string {
  const message =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? '');

  if (/overlapping pending or active lease/i.test(message) || /exclusion_violation/i.test(message)) {
    return 'This space already has a pending or active lease for overlapping dates. Terminate or renew the existing agreement instead.';
  }
  if (/sale property/i.test(message)) {
    return 'Cannot create a rental lease for a sale property.';
  }
  if (/must be a landlord/i.test(message)) {
    return 'Selected owner must be a landlord account.';
  }
  if (/Booking not found/i.test(message)) {
    return 'Booking not found or does not match this client and property.';
  }
  if (/link.*deposit|already linked|must be verified/i.test(message)) {
    return message || 'Could not link the verified deposit to the lease.';
  }
  return message || 'Failed to assign lease.';
}

/** Promote a client profile to tenant after lease assignment. Throws on failure. */
export async function promoteClientToTenant(profileId: string, currentRole?: string): Promise<void> {
  if (currentRole && currentRole !== 'client') return;

  if (!currentRole) {
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', profileId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!profile || profile.role !== 'client') return;
  }

  const { error } = await supabase.from('profiles').update({ role: 'tenant' }).eq('id', profileId);
  if (error) throw error;
}

export type CreatePendingLeaseFromBookingParams = {
  clientId: string;
  propertyId: string;
  ownerId: string;
  unitId?: string | null;
  startDate: string;
  endDate: string;
  rentAmount: number;
  depositAmount?: number;
  bookingId?: string | null;
  depositId?: string | null;
};

/** Atomically create a pending lease (owner, link deposit, promote, complete booking). */
export async function createPendingLeaseFromBooking(
  params: CreatePendingLeaseFromBookingParams,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_pending_lease_from_booking', {
    p_client_id: params.clientId,
    p_property_id: params.propertyId,
    p_owner_id: params.ownerId,
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_rent_amount: params.rentAmount,
    p_unit_id: params.unitId || null,
    p_deposit_amount: params.depositAmount ?? 0,
    p_booking_id: params.bookingId || null,
    p_deposit_id: params.depositId || null,
  });
  if (error) throw error;
  return data as string;
}

export type AssignableUnit = {
  id: string;
  unit_number: string;
  rent_amount: number;
};

/**
 * Vacant units for a property that do not already have a pending/active lease.
 * Pending leases leave units marked vacant, so status alone is not enough.
 */
export async function fetchAssignableUnits(propertyId: string): Promise<AssignableUnit[]> {
  const [{ data: units, error: unitsError }, { data: leases, error: leasesError }] = await Promise.all([
    supabase
      .from('units')
      .select('id, unit_number, rent_amount')
      .eq('property_id', propertyId)
      .eq('status', 'vacant')
      .order('unit_number', { ascending: true }),
    supabase
      .from('leases')
      .select('unit_id')
      .eq('property_id', propertyId)
      .in('status', ['pending', 'active'])
      .not('unit_id', 'is', null),
  ]);

  if (unitsError) throw unitsError;
  if (leasesError) throw leasesError;

  const blocked = new Set((leases || []).map((l) => l.unit_id).filter(Boolean) as string[]);
  return ((units as AssignableUnit[]) || []).filter((u) => !blocked.has(u.id));
}
