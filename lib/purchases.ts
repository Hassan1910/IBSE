import { supabase } from './supabase';
import {
  deletePaymentProof,
  deletePurchaseDocumentFile,
  uploadPaymentProof,
  uploadPurchaseDocumentFile,
  type PickedDocument,
  type PickedImage,
} from './storage';

export type PurchaseStatus = 'pending' | 'verified' | 'failed';
export type PurchasePaymentMethod = 'mpesa' | 'bank' | 'cash';
export type PurchaseDocType = 'sale_agreement' | 'id' | 'receipt' | 'other';

export interface PropertyPurchase {
  id: string;
  property_id: string;
  buyer_id: string;
  amount: number;
  payment_method: PurchasePaymentMethod;
  reference_code: string;
  proof_url: string | null;
  status: PurchaseStatus;
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
  purchase_documents?: PurchaseDocument[];
}

export interface PurchaseDocument {
  id: string;
  purchase_id: string;
  doc_type: PurchaseDocType;
  title: string;
  file_url: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface PendingPurchaseQueueItem extends PropertyPurchase {
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
  } | null;
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function uniqueViolationMessage(error: { code?: string; message?: string; details?: string }) {
  const haystack = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  if (haystack.includes('pending_buyer_property') || haystack.includes('pending_client_property')) {
    return 'You already have a pending purchase for this property.';
  }
  if (haystack.includes('reference_code') || haystack.includes('reference_code_key')) {
    return 'This transaction reference code has already been submitted.';
  }
  if (haystack.includes('verified_property')) {
    return 'This property already has a verified purchase.';
  }
  return null;
}

export function generatePurchaseReference() {
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `BUY${suffix}`;
}

export async function submitPropertyPurchase(input: {
  buyerId: string;
  propertyId: string;
  amount: number;
  paymentMethod: PurchasePaymentMethod;
  referenceCode: string;
  proof?: PickedImage | PickedDocument | null;
}) {
  let proofUrl: string | null = null;
  if (input.proof) {
    proofUrl = await uploadPaymentProof(input.buyerId, input.proof);
  }

  const tryInsert = async (reference: string) =>
    supabase
      .from('property_purchases')
      .insert({
        property_id: input.propertyId,
        buyer_id: input.buyerId,
        amount: input.amount,
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
      throw new Error('You already have a pending purchase for this property.');
    }
    if (error.message?.includes('not available') || error.message?.includes('Only sale')) {
      throw new Error(error.message);
    }
    if (
      error.message?.includes('account_status') ||
      error.code === '42501' ||
      error.message?.toLowerCase().includes('row-level security')
    ) {
      throw new Error('Your account must be approved before submitting a purchase.');
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

export async function fetchBuyerPurchases(buyerId: string): Promise<PropertyPurchase[]> {
  const { data, error } = await supabase
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
      properties ( title, location, price, status ),
      purchase_documents ( id, purchase_id, doc_type, title, file_url, uploaded_by, created_at )
    `
    )
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as unknown as PropertyPurchase[]) || [];
}

export async function fetchPendingPurchases(limit = 50): Promise<PendingPurchaseQueueItem[]> {
  const { data, error } = await supabase
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
    .limit(limit);

  if (error) throw error;
  return (data as unknown as PendingPurchaseQueueItem[]) || [];
}

export async function completePurchase(purchaseId: string) {
  const { data, error } = await supabase.rpc('complete_property_purchase', {
    p_purchase_id: purchaseId,
  });
  if (error) throw error;
  return data as string;
}

export async function rejectPurchase(purchaseId: string, notes?: string) {
  const { data, error } = await supabase.rpc('reject_property_purchase', {
    p_purchase_id: purchaseId,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function uploadPurchaseDocument(input: {
  purchaseId: string;
  uploadedBy: string;
  docType: PurchaseDocType;
  title: string;
  doc: PickedDocument;
}) {
  const stamp = Date.now();
  const safeName = input.doc.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${input.purchaseId}/${stamp}_${safeName}`;
  const fileUrl = await uploadPurchaseDocumentFile(path, input.doc);

  const { data, error } = await supabase
    .from('purchase_documents')
    .insert({
      purchase_id: input.purchaseId,
      doc_type: input.docType,
      title: input.title.trim() || input.doc.name,
      file_url: fileUrl,
      uploaded_by: input.uploadedBy,
    })
    .select('id, purchase_id, doc_type, title, file_url, uploaded_by, created_at')
    .single();

  if (error) {
    await deletePurchaseDocumentFile(fileUrl).catch(() => {});
    throw error;
  }
  return data as PurchaseDocument;
}

export async function fetchPurchaseDocuments(purchaseId: string): Promise<PurchaseDocument[]> {
  const { data, error } = await supabase
    .from('purchase_documents')
    .select('id, purchase_id, doc_type, title, file_url, uploaded_by, created_at')
    .eq('purchase_id', purchaseId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as PurchaseDocument[]) || [];
}
