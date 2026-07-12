import React, { useState, useEffect, useRef } from 'react';
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
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { leaseTotalRent } from '../../lib/leases';
import { notifyPropertyOwner } from '../../lib/notifications';
import { useUser } from '@clerk/clerk-expo';
import { useAudit } from '../../hooks/useAudit';
import { DollarSign, Key, Send, Smartphone } from 'lucide-react-native';

const PAYMENT_METHODS = [
  { label: 'M-Pesa Mobile Money', value: 'mpesa' },
  { label: 'Bank Transfer', value: 'bank' },
  { label: 'Cash Payment', value: 'cash' },
];

const SIM_REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type StkStep = 'sending' | 'pin' | 'success';

function generateSimReference() {
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += SIM_REF_ALPHABET[Math.floor(Math.random() * SIM_REF_ALPHABET.length)];
  }
  return `SIM${suffix}`;
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
  const [loadingLease, setLoadingLease] = useState(true);
  const [leaseLoadError, setLeaseLoadError] = useState(false);
  const [recentPaymentNote, setRecentPaymentNote] = useState<string | null>(null);

  // Form States
  const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'bank' | 'cash'>('mpesa');
  const [amount, setAmount] = useState('');
  const [refCode, setRefCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // M-Pesa STK mock (demo UI — still inserts pending for landlord verification)
  const [stkVisible, setStkVisible] = useState(false);
  const [stkStep, setStkStep] = useState<StkStep>('sending');
  const [stkPin, setStkPin] = useState('');
  const [stkRef, setStkRef] = useState('');
  const sendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(price);

  const applyBalance = (lease: any, verified: number) => {
    const total = leaseTotalRent(lease.rent_amount, lease.start_date, lease.end_date);
    const due = Math.max(total - verified, 0);
    setLeaseTotal(total);
    setPaidTotal(verified);
    setOutstanding(due);
    setAmount(due > 0 ? due.toString() : '');
  };

  const refreshBalance = async (lease: any) => {
    const { data: payments, error: payError } = await supabase
      .from('payments')
      .select('amount')
      .eq('lease_id', lease.id)
      .eq('status', 'verified');

    if (payError) throw payError;

    const verified = (payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    applyBalance(lease, verified);
  };

  useEffect(() => {
    const fetchPayableLease = async () => {
      if (!user) return;
      try {
        setLoadingLease(true);
        setLeaseLoadError(false);
        // Prefer an active lease; otherwise allow payment on a pending assignment.
        const { data, error } = await supabase
          .from('leases')
          .select(`
            id,
            property_id,
            rent_amount,
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
        }
      } catch (err: any) {
        console.error('Fetch payable lease error:', err);
        setLeaseLoadError(true);
        Alert.alert('Error', 'Failed to load your lease. Pull back later or try again.');
      } finally {
        setLoadingLease(false);
      }
    };

    fetchPayableLease();
  }, [user]);

  // Deep-link from payment notification: show a note for that payment id.
  useEffect(() => {
    const loadFocusedPayment = async () => {
      if (!focusPaymentId || !user?.id) return;
      try {
        const { data, error } = await supabase
          .from('payments')
          .select('id, amount, reference_code, status, payment_method')
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

  useEffect(() => {
    return () => {
      if (sendingTimerRef.current) clearTimeout(sendingTimerRef.current);
    };
  }, []);

  const insertPayment = async (opts: {
    method: 'mpesa' | 'bank' | 'cash';
    reference: string;
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
        })
        .select('id')
        .single();

    let usedReference = opts.reference;
    let { data, error } = await tryInsert(usedReference);

    if (error?.code === '23505') {
      usedReference = generateSimReference();
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

  const resetStkModal = () => {
    if (sendingTimerRef.current) {
      clearTimeout(sendingTimerRef.current);
      sendingTimerRef.current = null;
    }
    setStkVisible(false);
    setStkStep('sending');
    setStkPin('');
    setStkRef('');
  };

  const openStkModal = () => {
    if (!activeLease) {
      Alert.alert('No Lease Found', 'You do not have a lease awaiting payment.');
      return;
    }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid positive amount.');
      return;
    }

    setStkPin('');
    setStkRef('');
    setStkStep('sending');
    setStkVisible(true);

    sendingTimerRef.current = setTimeout(() => {
      setStkStep('pin');
      sendingTimerRef.current = null;
    }, 1200);
  };

  const handleStkConfirmPin = async () => {
    if (!/^\d{4}$/.test(stkPin)) {
      Alert.alert('Validation Error', 'Enter a 4-digit M-Pesa PIN to continue.');
      return;
    }

    const generated = generateSimReference();
    setStkRef(generated);
    setStkStep('success');

    try {
      setSubmitting(true);

      const result = await insertPayment({
        method: 'mpesa',
        reference: generated,
        auditDescription: 'Tenant submitted simulated M-Pesa STK payment for verification.',
      });
      setStkRef(result.reference);

      await refreshBalance(activeLease);

      resetStkModal();
      Alert.alert(
        'Submission Received',
        activeLease?.status === 'pending'
          ? `M-Pesa payment of ${formatPrice(parseFloat(amount))} was submitted (ref ${result.reference}). Once your landlord verifies it, your lease will become active.`
          : `M-Pesa payment of ${formatPrice(parseFloat(amount))} was submitted for verification (ref ${result.reference}).`
      );
    } catch (err: any) {
      console.error('Simulated M-Pesa payment error:', err);
      setStkStep('pin');
      Alert.alert('Payment Failed', err.message || 'Failed to submit simulated M-Pesa payment.');
    } finally {
      setSubmitting(false);
    }
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
      await insertPayment({
        method: paymentMethod,
        reference: refCode.trim().toUpperCase(),
        auditDescription: 'Tenant submitted rent payment reference.',
      });

      Alert.alert(
        'Submission Received',
        activeLease.status === 'pending'
          ? 'Your payment proof has been sent for verification. Once verified, your lease will become active.'
          : 'Your payment proof has been sent for verification. You can track its status on the dashboard.'
      );
      setRefCode('');
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {leaseLoadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              Could not load your lease. Check your connection and try again.
            </Text>
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
                <Text style={styles.balanceLabel}>Lease total</Text>
                <Text style={styles.balanceValue}>{formatPrice(leaseTotal)}</Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Verified paid</Text>
                <Text style={[styles.balanceValue, { color: '#10B981' }]}>{formatPrice(paidTotal)}</Text>
              </View>
              <View style={[styles.balanceRow, styles.balanceRowLast]}>
                <Text style={styles.balanceLabel}>Outstanding</Text>
                <Text style={[styles.balanceValue, { color: outstanding > 0 ? '#EAB308' : '#10B981' }]}>
                  {formatPrice(outstanding)}
                </Text>
              </View>
            </View>

            {/* Payment Method Selector */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Select Payment Method</Text>
              <View style={styles.methodList}>
                {PAYMENT_METHODS.map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[
                      styles.methodBtn,
                      paymentMethod === m.value && styles.methodBtnActive,
                    ]}
                    onPress={() => setPaymentMethod(m.value as any)}
                  >
                    <Text
                      style={[
                        styles.methodText,
                        paymentMethod === m.value && styles.methodTextActive,
                      ]}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Amount Input */}
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

            {paymentMethod === 'mpesa' ? (
              <>
                <Text style={styles.mpesaHint}>
                  Simulated STK push — enter any 4-digit PIN. Payment is submitted as pending for landlord verification.
                </Text>
                <TouchableOpacity style={styles.submitBtn} onPress={openStkModal} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <>
                      <Smartphone size={18} color="#0F172A" style={styles.btnIcon} />
                      <Text style={styles.submitBtnText}>Pay with M-Pesa</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Transaction Reference Code</Text>
                  <View style={styles.inputWrapper}>
                    <Key size={18} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. bank slip / receipt number"
                      placeholderTextColor="#999"
                      value={refCode}
                      onChangeText={setRefCode}
                      autoCapitalize="characters"
                    />
                  </View>
                </View>

                <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <>
                      <Send size={18} color="#0F172A" style={styles.btnIcon} />
                      <Text style={styles.submitBtnText}>Submit Reference</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={stkVisible}
        onRequestClose={() => {
          if (!submitting) resetStkModal();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.stkCard}>
            {stkStep === 'sending' ? (
              <>
                <ActivityIndicator size="large" color="#38BDF8" />
                <Text style={styles.stkTitle}>Sending M-Pesa prompt…</Text>
                <Text style={styles.stkSubtitle}>Check your phone for the STK push request.</Text>
              </>
            ) : null}

            {stkStep === 'pin' ? (
              <>
                <Text style={styles.stkBrand}>M-PESA</Text>
                <Text style={styles.stkTitle}>Enter M-Pesa PIN</Text>
                <Text style={styles.stkSubtitle}>
                  Pay {formatPrice(parseFloat(amount) || 0)} to IBSA Homes{'\n'}Till: 174379 (demo)
                </Text>
                <View style={styles.inputWrapper}>
                  <Key size={18} color="#94A3B8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="••••"
                    placeholderTextColor="#999"
                    value={stkPin}
                    onChangeText={(v) => setStkPin(v.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={4}
                    autoFocus
                  />
                </View>
                <TouchableOpacity
                  style={[styles.submitBtn, styles.stkConfirmBtn]}
                  onPress={handleStkConfirmPin}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.submitBtnText}>Confirm Payment</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={resetStkModal} disabled={submitting}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {stkStep === 'success' ? (
              <>
                <ActivityIndicator size="large" color="#10B981" />
                <Text style={styles.stkTitle}>Submitting payment…</Text>
                <Text style={styles.stkSubtitle}>
                  {stkRef ? `Reference ${stkRef}` : 'Recording payment for verification…'}
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 6,
    textAlign: 'center',
  },
  propertyHeader: {
    fontSize: 14,
    color: '#38BDF8',
    fontWeight: '500',
    marginBottom: 20,
    textAlign: 'center',
  },
  pendingHint: {
    fontSize: 13,
    color: '#EAB308',
    lineHeight: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  focusNote: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderColor: 'rgba(56, 189, 248, 0.4)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  focusNoteText: {
    color: '#7DD3FC',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  mpesaHint: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginBottom: 12,
    textAlign: 'center',
  },
  balanceBox: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  balanceRowLast: {
    borderBottomWidth: 0,
  },
  balanceLabel: {
    color: '#94A3B8',
    fontSize: 13,
  },
  balanceValue: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  amountHint: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
  methodList: {
    marginTop: 4,
  },
  methodBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  methodBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  methodText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  methodTextActive: {
    color: '#38BDF8',
    fontWeight: 'bold',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 16,
    paddingVertical: 12,
  },
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 4,
  },
  btnIcon: {
    marginRight: 8,
  },
  submitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
  errorCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    borderColor: '#334155',
    borderWidth: 1,
    alignItems: 'center',
  },
  errorText: {
    color: '#EF4444',
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  stkCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 24,
    alignItems: 'center',
  },
  stkBrand: {
    color: '#10B981',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 2,
    marginBottom: 8,
  },
  stkTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  stkSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  stkConfirmBtn: {
    width: '100%',
    marginTop: 16,
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 8,
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
});
