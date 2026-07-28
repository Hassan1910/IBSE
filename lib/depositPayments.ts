import { supabase } from './supabase';
import {
  deletePaymentProof,
  uploadPaymentProof,
  type PickedDocument,
  type PickedImage,
} from './storage';

export type DepositPaymentStatus =
  | 'pending'
  | 'verified'
  | 'failed'
  | 'released'
  | 'settled';
export type DepositPaymentMethod = 'mpesa' | 'bank' | 'cash';
export type DepositSettleOutcome = 'refunded' | 'partial';

function uniqueViolationMessage(error: { code?: string; message?: string; details?: string }) {
  const haystack = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  if (haystack.includes('pending_client_property') || haystack.includes('pending_buyer_property')) {
    return 'You already have a pending deposit for this property.';
  }
  if (haystack.includes('reference_code') || haystack.includes('reference_code_key')) {
    return 'This transaction reference code has already been submitted.';
  }
  if (haystack.includes('verified_property')) {
    return 'This property already has a verified deposit hold.';
  }
  return null;
}

export interface DepositPayment {
  id: string;
  property_id: string;
  client_id: string;
  booking_id: string | null;
  lease_id: string | null;
  amount: number;
  payment_method: DepositPaymentMethod;
  reference_code: string;
  proof_url: string | null;
  status: DepositPaymentStatus;
  notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  properties?: {
    title: string;
    location: string;
    price: number;
    status: string;
  } | null;
}

export interface PendingDepositQueueItem extends DepositPayment {
  profiles: {
    full_name: string;
    email: string;
    phone: string | null;
  } | null;
  properties: {
    title: string;
    location: string;
    price: number;
    status: string;
    type?: string;
    owner_id?: string | null;
  } | null;
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function depositAmountFromRent(rent: number) {
  if (!Number.isFinite(rent) || rent <= 0) return 0;
  return Math.round((rent / 2) * 100) / 100;
}

/** Short “what’s next” copy after a booking deposit, for tenant/client UIs. */
export function getDepositNextStep(
  deposit: Pick<DepositPayment, 'status' | 'lease_id'>,
  linkedLeaseStatus?: string | null
): { message: string; showPayRentCta: boolean } {
  switch (deposit.status) {
    case 'pending':
      return {
        message:
          'Waiting for IBSA to verify. The listing stays available until verified.',
        showPayRentCta: false,
      };
    case 'failed':
      return {
        message:
          'Rejected — you can submit a new deposit if the property is available again.',
        showPayRentCta: false,
      };
    case 'released':
      return {
        message:
          'Reservation released. You can submit a new deposit if the property is available again.',
        showPayRentCta: false,
      };
    case 'settled':
      return {
        message: 'This security deposit was settled at the end of the tenancy.',
        showPayRentCta: false,
      };
    case 'verified': {
      if (linkedLeaseStatus === 'pending') {
        return {
          message:
            'Your lease is ready. Submit first rent on Pay Rent to activate and move in.',
          showPayRentCta: true,
        };
      }
      if (linkedLeaseStatus === 'active') {
        return {
          message: 'Deposit is held on your active lease.',
          showPayRentCta: false,
        };
      }
      if (!deposit.lease_id) {
        return {
          message:
            'Deposit held. IBSA will create your lease after viewing approval. Then pay first rent on Pay Rent to move in.',
          showPayRentCta: false,
        };
      }
      return {
        message:
          'Deposit held and linked to your lease. Submit first rent on Pay Rent if your lease is still pending.',
        showPayRentCta: true,
      };
    }
    default: {
      const _exhaustive: never = deposit.status;
      return _exhaustive;
    }
  }
}

export function generateDepositReference() {
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `DEP${suffix}`;
}

export async function submitDepositPayment(input: {
  clientId: string;
  propertyId: string;
  paymentMethod: DepositPaymentMethod;
  referenceCode: string;
  bookingId?: string | null;
  /** Sent for display only; DB forces amount = half rent. */
  amount?: number;
  proof?: PickedImage | PickedDocument | null;
}) {
  let proofUrl: string | null = null;
  if (input.proof) {
    proofUrl = await uploadPaymentProof(input.clientId, input.proof);
  }

  const amount = input.amount && input.amount > 0 ? input.amount : 1;

  const tryInsert = async (reference: string) =>
    supabase
      .from('deposit_payments')
      .insert({
        property_id: input.propertyId,
        client_id: input.clientId,
        booking_id: input.bookingId || null,
        amount,
        payment_method: input.paymentMethod,
        reference_code: reference,
        status: 'pending',
        proof_url: proofUrl,
      })
      .select('id, reference_code, amount')
      .single();

  const usedReference = input.referenceCode.trim().toUpperCase();
  const { data, error } = await tryInsert(usedReference);

  if (error) {
    if (proofUrl) {
      await deletePaymentProof(proofUrl).catch(() => {});
    }
    if (error.code === '23505') {
      throw new Error(
        uniqueViolationMessage(error) ||
          'This transaction reference code has already been submitted. Enter the exact code from your payment confirmation.'
      );
    }
    if (error.message?.includes('pending')) {
      throw new Error('You already have a pending deposit for this property.');
    }
    if (
      error.message?.includes('not available') ||
      error.message?.includes('Only rental') ||
      error.message?.includes('booking deposit')
    ) {
      throw new Error(error.message);
    }
    if (
      error.message?.includes('account_status') ||
      error.code === '42501' ||
      error.message?.toLowerCase().includes('row-level security')
    ) {
      throw new Error('Your account must be approved before submitting a deposit.');
    }
    throw error;
  }

  return {
    id: data!.id as string,
    reference: usedReference,
    amount: Number(data!.amount),
    proofUrl,
  };
}

export async function fetchClientDepositPayments(clientId: string): Promise<DepositPayment[]> {
  const { data, error } = await supabase
    .from('deposit_payments')
    .select(
      `
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
      properties ( title, location, price, status )
    `
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as unknown as DepositPayment[]) || [];
}

export async function fetchPendingDepositPayments(limit = 50): Promise<PendingDepositQueueItem[]> {
  const { data, error } = await supabase
    .from('deposit_payments')
    .select(
      `
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
      properties ( title, location, price, status )
    `
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data as unknown as PendingDepositQueueItem[]) || [];
}

export async function fetchVerifiedDepositForClientProperty(
  clientId: string,
  propertyId: string
): Promise<DepositPayment | null> {
  const { data, error } = await supabase
    .from('deposit_payments')
    .select(
      `
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
      created_at
    `
    )
    .eq('client_id', clientId)
    .eq('property_id', propertyId)
    .eq('status', 'verified')
    .is('lease_id', null)
    .maybeSingle();

  if (error) throw error;
  return (data as DepositPayment | null) || null;
}

export async function completeDepositPayment(depositId: string) {
  const { data, error } = await supabase.rpc('complete_deposit_payment', {
    p_deposit_id: depositId,
  });
  if (error) throw error;
  return data as string;
}

export async function rejectDepositPayment(depositId: string, notes?: string) {
  const { data, error } = await supabase.rpc('reject_deposit_payment', {
    p_deposit_id: depositId,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function releaseDepositPayment(depositId: string, notes?: string) {
  const { data, error } = await supabase.rpc('release_deposit_payment', {
    p_deposit_id: depositId,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function linkDepositPaymentToLease(depositId: string, leaseId: string) {
  const { data, error } = await supabase.rpc('link_deposit_payment_to_lease', {
    p_deposit_id: depositId,
    p_lease_id: leaseId,
  });
  if (error) throw error;
  return data as string;
}

export async function settleLeaseDeposit(
  leaseId: string,
  outcome: DepositSettleOutcome,
  notes?: string
) {
  const { data, error } = await supabase.rpc('settle_lease_deposit', {
    p_lease_id: leaseId,
    p_outcome: outcome,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Terminate a lease and optionally settle its held deposit in one transaction. */
export async function terminateLeaseWithDeposit(
  leaseId: string,
  outcome?: DepositSettleOutcome | null,
  notes?: string
) {
  const { data, error } = await supabase.rpc('terminate_lease_with_deposit', {
    p_lease_id: leaseId,
    p_outcome: outcome ?? null,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchAdminDepositStats(): Promise<{
  deposits_held: number;
  deposits_refunded: number;
  deposits_retained: number;
  deposits_pending: number;
  deposits_pending_count: number;
}> {
  const { data, error } = await supabase.rpc('admin_deposit_stats');
  if (error) throw error;
  const row = (data || {}) as Record<string, unknown>;
  return {
    deposits_held: Number(row.deposits_held ?? 0),
    deposits_refunded: Number(row.deposits_refunded ?? 0),
    deposits_retained: Number(row.deposits_retained ?? 0),
    deposits_pending: Number(row.deposits_pending ?? 0),
    deposits_pending_count: Number(row.deposits_pending_count ?? 0),
  };
}
