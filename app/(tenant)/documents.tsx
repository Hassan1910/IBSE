import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { FileText, Link as LinkIcon, Receipt } from 'lucide-react-native';

interface LeaseDocument {
  id: string;
  contract_url: string | null;
  start_date: string;
  end_date: string;
  status: string;
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
        const { data: leaseData, error: leaseError } = await supabase
          .from('leases')
          .select('id, contract_url, start_date, end_date, status, properties ( title )')
          .eq('tenant_id', user.id)
          .in('status', ['pending', 'active'])
          .order('status', { ascending: true })
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (leaseError) throw leaseError;

        const currentLease = (leaseData as any) || null;
        setLease(currentLease);

        if (currentLease?.id) {
          const { data: payments, error: paymentError } = await supabase
            .from('payments')
            .select('id, amount, payment_date, payment_method, reference_code')
            .eq('payer_id', user.id)
            .eq('lease_id', currentLease.id)
            .eq('status', 'verified')
            .order('payment_date', { ascending: false });

          if (paymentError) throw paymentError;
          setVerifiedPayments((payments as any) || []);
        } else {
          setVerifiedPayments([]);
        }
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
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Cannot Open', 'This link is not valid.');
    }
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
          <Text style={styles.cardTitle}>
            {lease?.status === 'pending' ? 'Pending Lease' : 'Current Lease'}
          </Text>
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
          <Text style={styles.emptyText}>No pending or active lease found.</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Verified Payment Records</Text>
      <Text style={styles.sectionHint}>These are payment records for your current lease, not downloadable PDF receipts.</Text>
      {verifiedPayments.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>No verified payments for this lease yet.</Text>
        </View>
      ) : (
        verifiedPayments.map((payment) => (
          <View key={payment.id} style={styles.card}>
            <View style={styles.rowHeader}>
              <Receipt size={16} color="#10B981" />
              <Text style={styles.cardTitle}>Ref #{payment.reference_code}</Text>
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
  sectionTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: 'bold', marginBottom: 6, marginTop: 8 },
  sectionHint: { color: '#64748B', fontSize: 12, marginBottom: 10, lineHeight: 17 },
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
