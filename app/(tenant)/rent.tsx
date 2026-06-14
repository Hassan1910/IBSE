import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { CreditCard, DollarSign, Key, Send } from 'lucide-react-native';

const PAYMENT_METHODS = [
  { label: 'M-Pesa Mobile Money', value: 'mpesa' },
  { label: 'Bank Transfer', value: 'bank' },
  { label: 'Cash Payment', value: 'cash' },
];

export default function RentPaymentScreen() {
  const { user } = useUser();
  const [activeLease, setActiveLease] = useState<any>(null);
  const [loadingLease, setLoadingLease] = useState(true);

  // Form States
  const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'bank' | 'cash'>('mpesa');
  const [amount, setAmount] = useState('');
  const [refCode, setRefCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchActiveLease = async () => {
      if (!user) return;
      try {
        setLoadingLease(true);
        const { data, error } = await supabase
          .from('leases')
          .select(`
            id,
            rent_amount,
            properties ( title )
          `)
          .eq('tenant_id', user.id)
          .eq('status', 'active')
          .maybeSingle();

        if (error) throw error;
        if (data) {
          setActiveLease(data);
          setAmount(data.rent_amount.toString()); // Pre-fill amount
        }
      } catch (err: any) {
        console.error('Fetch active lease error:', err);
      } finally {
        setLoadingLease(false);
      }
    };

    fetchActiveLease();
  }, [user]);

  const handleSubmit = async () => {
    if (!user) return;
    if (!activeLease) {
      Alert.alert('No Lease Found', 'You do not have an active lease to pay for.');
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
      const { error } = await supabase.from('payments').insert({
        lease_id: activeLease.id,
        payer_id: user.id,
        amount: parseFloat(amount),
        payment_method: paymentMethod,
        reference_code: refCode.trim().toUpperCase(),
        status: 'pending',
      });

      if (error) {
        if (error.code === '23505') {
          throw new Error('This transaction reference code has already been submitted.');
        }
        throw error;
      }

      Alert.alert(
        'Submission Received 🎉',
        'Your payment proof has been sent to our finance officer for verification. You can track its status on the dashboard.'
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
        {!activeLease ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              In order to submit payment details, you must have an active lease assigned to you by an Administrator.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Submit Rent Payment Details</Text>
            <Text style={styles.propertyHeader}>Leased Property: {activeLease.properties?.title}</Text>

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

            {/* Reference Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Transaction Reference Code</Text>
              <View style={styles.inputWrapper}>
                <Key size={18} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. M-Pesa code: QWERT12345"
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
          </View>
        )}
      </ScrollView>
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
});
