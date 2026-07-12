import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { fetchLeaseBalance } from '../../lib/leases';
import { notifyPropertyOwner } from '../../lib/notifications';
import { pickDocument, pickImages, uploadPaymentProof, type PickedDocument, type PickedImage } from '../../lib/storage';
import { useUser } from '@clerk/clerk-expo';
import { useAudit } from '../../hooks/useAudit';
import { DollarSign, Key, Send, Paperclip, X } from 'lucide-react-native';

const PAYMENT_METHODS = [
  { label: 'M-Pesa Mobile Money', value: 'mpesa' },
  { label: 'Bank Transfer', value: 'bank' },
  { label: 'Cash Payment', value: 'cash' },
];

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateFallbackReference() {
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `REF${suffix}`;
}

export default function RentPaymentScreen() {
  const { user } = useUser();
  const { log } = useAudit();
  const router = useRouter();
  const { id: focusPaymentId } = useLocalSearchParams<{ id?: string }>();
  const [activeLease, setActiveLease] = useState<any>(null);
  const [leaseTotal, setLeaseTotal] = useState(0);
  const [paidTotal, setPaidTotal] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositStatus, setDepositStatus] = useState('none');
  const [loadingLease, setLoadingLease] = useState(true);
  const [leaseLoadError, setLeaseLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [recentPaymentNote, setRecentPaymentNote] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'bank' | 'cash'>('mpesa');
  const [amount, setAmount] = useState('');
  const [refCode, setRefCode] = useState('');
  const [proof, setProof] = useState<PickedImage | PickedDocument | null>(null);
  const [proofPreviewUri, setProofPreviewUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(price);

  const applyBalance = (balance: Awaited<ReturnType<typeof fetchLeaseBalance>>) => {
    setLeaseTotal(balance.charges_total);
    setPaidTotal(balance.paid_total);
    setOutstanding(balance.outstanding);
    setDepositAmount(balance.deposit_amount);
    setDepositStatus(balance.deposit_status);
    setAmount(balance.outstanding > 0 ? balance.outstanding.toString() : '');
  };

  const refreshBalance = async (lease: any) => {
    const balance = await fetchLeaseBalance(lease.id);
    applyBalance(balance);
  };

  const fetchPayableLease = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id) return;
    try {
      if (!opts?.silent) setLoadingLease(true);
      setLeaseLoadError(false);
      const { data, error } = await supabase
        .from('leases')
        .select(`
            id,
            property_id,
            rent_amount,
            deposit_amount,
            deposit_status,
            start_date,
            end_date,
            status,
            properties ( title )
          `)
        .eq('tenant_id', user.id)
        .in('status', ['pending', 'active'])
        .order('status', { ascending: true })
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setActiveLease(data);
        await refreshBalance(data);
      } else {
        setActiveLease(null);
      }
    } catch (err: any) {
      console.error('Fetch payable lease error:', err);
      setLeaseLoadError(true);
      if (!opts?.silent) {
        Alert.alert('Error', 'Failed to load your lease. Pull back later or try again.');
      }
    } finally {
      setLoadingLease(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchPayableLease();
  }, [fetchPayableLease]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchPayableLease({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [fetchPayableLease]);

  useEffect(() => {
    const loadFocusedPayment = async () => {
      if (!focusPaymentId || !user?.id) return;
      try {
        const { data, error } = await supabase
          .from('payments')
          .select('id, amount, reference_code, status, payment_method, proof_url, receipt_url')
          .eq('id', focusPaymentId)
          .eq('payer_id', user.id)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          setRecentPaymentNote(
            `Payment ${data.reference_code} (${data.payment_method.toUpperCase()}) — ${data.status.toUpperCase()} · KES ${Number(data.amount).toLocaleString()}`,
          );
        }
      } catch (err) {
        console.error('Load focused payment error:', err);
      } finally {
        router.setParams({ id: undefined });
      }
    };
    loadFocusedPayment();
  }, [focusPaymentId, user?.id, router]);

  const handlePickProofImage = async () => {
    try {
      const images = await pickImages(false);
      if (!images.length) return;
      setProof(images[0]);
      setProofPreviewUri(images[0].uri);
    } catch (err: any) {
      Alert.alert('Proof Upload', err.message || 'Could not pick image.');
    }
  };

  const handlePickProofDoc = async () => {
    try {
      const doc = await pickDocument();
      if (!doc) return;
      setProof(doc);
      setProofPreviewUri(doc.mimeType.startsWith('image/') ? doc.uri : null);
    } catch (err: any) {
      Alert.alert('Proof Upload', err.message || 'Could not pick document.');
    }
  };

  const insertPayment = async (opts: {
    method: 'mpesa' | 'bank' | 'cash';
    reference: string;
    proofUrl: string | null;
    auditDescription: string;
  }) => {
    if (!user || !activeLease) {
      throw new Error('You do not have a lease awaiting payment.');
    }

    const parsedAmount = parseFloat(amount);
    const tryInsert = async (reference: string) =>
      supabase
        .from('payments')
        .insert({
          lease_id: activeLease.id,
          payer_id: user.id,
          amount: parsedAmount,
          payment_method: opts.method,
          reference_code: reference,
          status: 'pending',
          proof_url: opts.proofUrl,
        })
        .select('id')
        .single();

    let usedReference = opts.reference;
    let { data, error } = await tryInsert(usedReference);

    if (error?.code === '23505') {
      usedReference = generateFallbackReference();
      ({ data, error } = await tryInsert(usedReference));
    }

    if (error) {
      if (error.code === '23505') {
        throw new Error('This transaction reference code has already been submitted.');
      }
      throw error;
    }

    await log({
      action: 'create',
      entityType: 'payment',
      entityId: data?.id,
      description: opts.auditDescription,
    });

    if (data?.id && activeLease.property_id) {
      try {
        await notifyPropertyOwner({
          propertyId: activeLease.property_id,
          type: 'payment_submitted',
          title: 'Rent Payment Submitted',
          body: `A tenant submitted a payment of KES ${parsedAmount.toLocaleString()} for verification (ref ${usedReference}).`,
          entityType: 'payment',
          entityId: data.id,
        });
      } catch (notifyErr) {
        console.error('Notify landlord of payment error:', notifyErr);
      }
    }

    return { id: data?.id as string | undefined, reference: usedReference };
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!activeLease) {
      Alert.alert('No Lease Found', 'You do not have a lease awaiting payment.');
      return;
    }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid positive amount.');
      return;
    }
    if (!refCode.trim()) {
      Alert.alert('Validation Error', 'Please enter your payment reference code.');
      return;
    }

    try {
      setSubmitting(true);
      let proofUrl: string | null = null;
      if (proof) {
        proofUrl = await uploadPaymentProof(user.id, proof);
      }

      const result = await insertPayment({
        method: paymentMethod,
        reference: refCode.trim().toUpperCase(),
        proofUrl,
        auditDescription: `Tenant submitted ${paymentMethod} rent payment reference for verification.`,
      });

      await refreshBalance(activeLease);

      Alert.alert(
        'Submission Received',
        activeLease.status === 'pending'
          ? `Payment of ${formatPrice(parseFloat(amount))} (ref ${result.reference}) was submitted. Once verified, your lease will become active.`
          : `Payment of ${formatPrice(parseFloat(amount))} (ref ${result.reference}) was submitted for verification.`,
      );
      setRefCode('');
      setProof(null);
      setProofPreviewUri(null);
    } catch (err: any) {
      console.error('Submit payment reference error:', err);
      Alert.alert('Submission Failed', err.message || 'Failed to submit payment details.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingLease) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  const methodHint =
    paymentMethod === 'mpesa'
      ? 'Pay via M-Pesa (Paybill/Till), then enter the M-Pesa confirmation code below. Optionally attach a screenshot. Staff will verify before the payment is applied.'
      : paymentMethod === 'bank'
        ? 'Transfer to the IBSA bank account, then enter the bank slip or transfer reference below. Attach a slip photo if you have one.'
        : 'After paying cash to an authorized collector, enter the receipt number below and attach a photo of the receipt if available.';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38BDF8" />
        }
      >
        {leaseLoadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              Could not load your lease. Check your connection and try again.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void fetchPayableLease()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !activeLease ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              You need a pending or active lease assigned by your landlord before you can submit rent payment details.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Submit Rent Payment Details</Text>
            <Text style={styles.propertyHeader}>Leased Property: {activeLease.properties?.title}</Text>
            {recentPaymentNote ? (
              <View style={styles.focusNote}>
                <Text style={styles.focusNoteText}>{recentPaymentNote}</Text>
              </View>
            ) : null}
            {activeLease.status === 'pending' ? (
              <Text style={styles.pendingHint}>
                This lease is pending payment confirmation. Submit M-Pesa, bank, or cash details for your landlord to verify before the lease activates.
              </Text>
            ) : null}

            <View style={styles.balanceBox}>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Charges total</Text>
                <Text style={styles.balanceValue}>{formatPrice(leaseTotal)}</Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Verified paid</Text>
                <Text style={[styles.balanceValue, { color: '#10B981' }]}>{formatPrice(paidTotal)}</Text>
              </View>
              {depositAmount > 0 ? (
                <View style={styles.balanceRow}>
                  <Text style={styles.balanceLabel}>Deposit ({depositStatus})</Text>
                  <Text style={styles.balanceValue}>{formatPrice(depositAmount)}</Text>
                </View>
              ) : null}
              <View style={[styles.balanceRow, styles.balanceRowLast]}>
                <Text style={styles.balanceLabel}>Outstanding</Text>
                <Text style={[styles.balanceValue, { color: outstanding > 0 ? '#EAB308' : '#10B981' }]}>
                  {formatPrice(outstanding)}
                </Text>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Select Payment Method</Text>
              <View style={styles.methodList}>
                {PAYMENT_METHODS.map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.methodBtn, paymentMethod === m.value && styles.methodBtnActive]}
                    onPress={() => setPaymentMethod(m.value as 'mpesa' | 'bank' | 'cash')}
                  >
                    <Text style={[styles.methodText, paymentMethod === m.value && styles.methodTextActive]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.methodHint}>{methodHint}</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Amount Paid (KES)</Text>
              <Text style={styles.amountHint}>
                {outstanding > 0
                  ? `Prefilled with outstanding balance (${formatPrice(outstanding)}). You can change it for a partial payment.`
                  : 'This lease is fully paid. Enter an amount only if submitting an extra payment.'}
              </Text>
              <View style={styles.inputWrapper}>
                <DollarSign size={18} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 25000"
                  placeholderTextColor="#999"
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Transaction Reference Code</Text>
              <View style={styles.inputWrapper}>
                <Key size={18} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder={
                    paymentMethod === 'mpesa'
                      ? 'e.g. M-Pesa confirmation code'
                      : 'e.g. bank slip / receipt number'
                  }
                  placeholderTextColor="#999"
                  value={refCode}
                  onChangeText={setRefCode}
                  autoCapitalize="characters"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Payment Proof (optional)</Text>
              <View style={styles.proofRow}>
                <TouchableOpacity style={styles.proofBtn} onPress={handlePickProofImage}>
                  <Paperclip size={14} color="#38BDF8" />
                  <Text style={styles.proofBtnText}>Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.proofBtn} onPress={handlePickProofDoc}>
                  <Paperclip size={14} color="#38BDF8" />
                  <Text style={styles.proofBtnText}>PDF / File</Text>
                </TouchableOpacity>
                {proof ? (
                  <TouchableOpacity
                    style={styles.proofClear}
                    onPress={() => {
                      setProof(null);
                      setProofPreviewUri(null);
                    }}
                  >
                    <X size={14} color="#EF4444" />
                  </TouchableOpacity>
                ) : null}
              </View>
              {proofPreviewUri ? (
                <Image source={{ uri: proofPreviewUri }} style={styles.proofPreview} />
              ) : proof && 'name' in proof ? (
                <Text style={styles.proofName}>{proof.name}</Text>
              ) : null}
            </View>

            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
              {submitting ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <>
                  <Send size={18} color="#0F172A" style={styles.btnIcon} />
                  <Text style={styles.submitBtnText}>Submit for Verification</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' },
  scrollContainer: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC', marginBottom: 6, textAlign: 'center' },
  propertyHeader: { fontSize: 14, color: '#94A3B8', textAlign: 'center', marginBottom: 12 },
  pendingHint: { color: '#EAB308', fontSize: 13, lineHeight: 18, marginBottom: 12, textAlign: 'center' },
  focusNote: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  focusNoteText: { color: '#38BDF8', fontSize: 12 },
  balanceBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  balanceRowLast: { marginBottom: 0, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#334155' },
  balanceLabel: { color: '#94A3B8', fontSize: 13 },
  balanceValue: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  inputGroup: { marginBottom: 16 },
  label: { color: '#CBD5E1', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  methodList: { gap: 8 },
  methodBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#0F172A',
  },
  methodBtnActive: { borderColor: '#38BDF8', backgroundColor: 'rgba(56, 189, 248, 0.12)' },
  methodText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  methodTextActive: { color: '#38BDF8' },
  methodHint: { color: '#64748B', fontSize: 12, lineHeight: 17, marginTop: 8 },
  amountHint: { color: '#64748B', fontSize: 12, marginBottom: 8, lineHeight: 17 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, color: '#F8FAFC', paddingVertical: 12, fontSize: 15 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proofBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0F172A',
  },
  proofBtnText: { color: '#38BDF8', fontSize: 12, fontWeight: '600' },
  proofClear: { padding: 8 },
  proofPreview: { marginTop: 10, width: '100%', height: 140, borderRadius: 8 },
  proofName: { color: '#94A3B8', fontSize: 12, marginTop: 8 },
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnIcon: { marginRight: 8 },
  submitBtnText: { color: '#0F172A', fontWeight: '700', fontSize: 15 },
  errorCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderColor: '#334155',
    borderWidth: 1,
  },
  errorText: { color: '#94A3B8', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryBtn: {
    marginTop: 16,
    alignSelf: 'center',
    backgroundColor: '#38BDF8',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: { color: '#0F172A', fontWeight: '700', fontSize: 14 },
});
