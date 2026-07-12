import * as Print from 'expo-print';
import { File } from 'expo-file-system';
import { Buffer } from 'buffer';
import { supabase } from './supabase';
import { uploadPaymentReceipt } from './storage';

export type ReceiptPayment = {
  id: string;
  amount: number;
  payment_method: string;
  reference_code: string;
  payment_date: string;
  payer_name?: string | null;
  property_title?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function receiptHtml(payment: ReceiptPayment) {
  const amount = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(Number(payment.amount));
  const date = new Date(payment.payment_date).toLocaleString('en-KE');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Helvetica, Arial, sans-serif; color: #0f172a; padding: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .muted { color: #64748b; font-size: 12px; margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
    .label { color: #64748b; font-size: 13px; }
    .value { font-size: 14px; font-weight: 600; }
    .amount { font-size: 28px; font-weight: 700; margin: 20px 0 8px; }
  </style>
</head>
<body>
  <h1>IBSA Homes</h1>
  <div class="muted">Payment receipt</div>
  <div class="amount">${escapeHtml(amount)}</div>
  <div class="row"><span class="label">Reference</span><span class="value">${escapeHtml(payment.reference_code)}</span></div>
  <div class="row"><span class="label">Method</span><span class="value">${escapeHtml(payment.payment_method.toUpperCase())}</span></div>
  <div class="row"><span class="label">Date</span><span class="value">${escapeHtml(date)}</span></div>
  <div class="row"><span class="label">Payer</span><span class="value">${escapeHtml(payment.payer_name || 'Tenant')}</span></div>
  <div class="row"><span class="label">Property</span><span class="value">${escapeHtml(payment.property_title || 'Lease payment')}</span></div>
  <div class="row"><span class="label">Receipt ID</span><span class="value">${escapeHtml(payment.id)}</span></div>
</body>
</html>`;
}

/** Generate a PDF receipt, upload it, and store receipt_url on the payment. */
export async function generateAndAttachReceipt(payment: ReceiptPayment): Promise<string | null> {
  try {
    const { uri } = await Print.printToFileAsync({ html: receiptHtml(payment) });
    const file = new File(uri);
    const arrayBuffer = await file.arrayBuffer();
    const path = `${payment.id}/${Date.now()}_receipt.pdf`;
    const url = await uploadPaymentReceipt(path, arrayBuffer);
    const { error } = await supabase
      .from('payments')
      .update({ receipt_url: url })
      .eq('id', payment.id);
    if (error) throw error;

    // Also add to lease vault when lease_id is known
    const { data: payRow } = await supabase
      .from('payments')
      .select('lease_id, payer_id')
      .eq('id', payment.id)
      .maybeSingle();
    if (payRow?.lease_id) {
      await supabase.from('lease_documents').insert({
        lease_id: payRow.lease_id,
        doc_type: 'receipt',
        title: `Receipt ${payment.reference_code}`,
        file_url: url,
        uploaded_by: payRow.payer_id,
      });
    }

    return url;
  } catch (err) {
    console.error('Generate receipt error:', err);
    return null;
  }
}

/** Upload base64 PDF from print (web fallback helper). */
export async function arrayBufferFromBase64(base64: string): Promise<ArrayBuffer> {
  const buf = Buffer.from(base64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
