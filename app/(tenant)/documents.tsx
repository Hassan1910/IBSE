import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { FileText, Link as LinkIcon, Receipt } from 'lucide-react-native';

interface LeaseDocument {
  id: string;
  contract_url: string | null;
  terms: string | null;
  start_date: string;
  end_date: string;
  properties: { title: string };
}

interface VerifiedPayment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference_code: string;
}

export default function TenantDocumentsScreen() {
  const { user } = useUser();
  const [lease, setLease] = useState<LeaseDocument | null>(null);
  const [verifiedPayments, setVerifiedPayments] = useState<VerifiedPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDocuments = async () => {
      if (!user?.id) return;

      try {
        setLoading(true);
        const [leaseRes, paymentRes] = await Promise.all([
          supabase
            .from('leases')
            .select('id, contract_url, terms, start_date, end_date, properties ( title )')
            .eq('tenant_id', user.id)
            .eq('status', 'active')
            .maybeSingle(),
          supabase
            .from('payments')
            .select('id, amount, payment_date, payment_method, reference_code')
            .eq('payer_id', user.id)
            .eq('status', 'verified')
            .order('payment_date', { ascending: false }),
        ]);

        if (leaseRes.error) throw leaseRes.error;
        if (paymentRes.error) throw paymentRes.error;

        setLease((leaseRes.data as any) || null);
        setVerifiedPayments((paymentRes.data as any) || []);
      } catch (err) {
        console.error('Fetch tenant documents error:', err);
        Alert.alert('Error', 'Failed to load your documents.');
      } finally {
        setLoading(false);
      }
    };

    fetchDocuments();
  }, [user?.id]);

  const openUrl = async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('Cannot Open', 'This link is not valid.');
      return;
    }
    Linking.openURL(url);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(price);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Lease Documents</Text>
      <View style={styles.card}>
        <View style={styles.rowHeader}>
          <FileText size={16} color="#38BDF8" />
          <Text style={styles.cardTitle}>Active Lease</Text>
        </View>
        {lease ? (
          <>
            <Text style={styles.metaText}>{lease.properties?.title}</Text>
            <Text style={styles.metaText}>Period: {formatDate(lease.start_date)} - {formatDate(lease.end_date)}</Text>
            <TouchableOpacity
              style={[styles.linkBtn, !lease.contract_url && styles.linkBtnDisabled]}
              disabled={!lease.contract_url}
              onPress={() => lease.contract_url && openUrl(lease.contract_url)}
            >
              <LinkIcon size={14} color="#0F172A" style={{ marginRight: 6 }} />
              <Text style={styles.linkBtnText}>{lease.contract_url ? 'Open Contract URL' : 'No Contract URL'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.emptyText}>No active lease agreement found.</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Payment Receipts</Text>
      {verifiedPayments.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>No verified payments yet.</Text>
        </View>
      ) : (
        verifiedPayments.map((payment) => (
          <View key={payment.id} style={styles.card}>
            <View style={styles.rowHeader}>
              <Receipt size={16} color="#10B981" />
              <Text style={styles.cardTitle}>Receipt #{payment.reference_code}</Text>
            </View>
            <Text style={styles.metaText}>Amount: {formatPrice(payment.amount)}</Text>
            <Text style={styles.metaText}>Method: {payment.payment_method.toUpperCase()}</Text>
            <Text style={styles.metaText}>Verified on: {formatDate(payment.payment_date)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 20, paddingBottom: 28 },
  centered: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: 'bold', marginBottom: 10, marginTop: 8 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    marginBottom: 12,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardTitle: { color: '#F8FAFC', marginLeft: 8, fontWeight: 'bold', fontSize: 14 },
  metaText: { color: '#CBD5E1', fontSize: 13, marginBottom: 6 },
  emptyText: { color: '#94A3B8', fontSize: 13 },
  linkBtn: {
    marginTop: 8,
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  linkBtnDisabled: { opacity: 0.6 },
  linkBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 13 },
});
