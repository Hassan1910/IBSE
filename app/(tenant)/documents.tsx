import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { FileText, Link as LinkIcon, Receipt } from 'lucide-react-native';

interface LeaseDocRow {
  id: string;
  doc_type: string;
  title: string;
  file_url: string;
  created_at: string;
}

interface VerifiedPayment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference_code: string;
  proof_url: string | null;
  receipt_url: string | null;
}

export default function TenantDocumentsScreen() {
  const { user } = useUser();
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [leaseTitle, setLeaseTitle] = useState('');
  const [docs, setDocs] = useState<LeaseDocRow[]>([]);
  const [verifiedPayments, setVerifiedPayments] = useState<VerifiedPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDocuments = useCallback(async () => {
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
      setLeaseId(currentLease?.id || null);
      setLeaseTitle(currentLease?.properties?.title || '');

      if (currentLease?.id) {
        const [{ data: vault, error: vaultError }, { data: payments, error: paymentError }] =
          await Promise.all([
            supabase
              .from('lease_documents')
              .select('id, doc_type, title, file_url, created_at')
              .eq('lease_id', currentLease.id)
              .order('created_at', { ascending: false }),
            supabase
              .from('payments')
              .select('id, amount, payment_date, payment_method, reference_code, proof_url, receipt_url')
              .eq('payer_id', user.id)
              .eq('lease_id', currentLease.id)
              .eq('status', 'verified')
              .order('payment_date', { ascending: false }),
          ]);
        if (vaultError) throw vaultError;
        if (paymentError) throw paymentError;

        let vaultDocs = (vault as LeaseDocRow[]) || [];
        // Fallback: surface legacy contract_url if vault is empty for contracts
        if (
          currentLease.contract_url &&
          !vaultDocs.some((d) => d.doc_type === 'contract' && d.file_url === currentLease.contract_url)
        ) {
          vaultDocs = [
            {
              id: 'legacy-contract',
              doc_type: 'contract',
              title: 'Lease contract',
              file_url: currentLease.contract_url,
              created_at: currentLease.start_date,
            },
            ...vaultDocs,
          ];
        }
        setDocs(vaultDocs);
        setVerifiedPayments((payments as any) || []);
      } else {
        setDocs([]);
        setVerifiedPayments([]);
      }
    } catch (err) {
      console.error('Fetch tenant documents error:', err);
      Alert.alert('Error', 'Failed to load your documents.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void fetchDocuments();
    }, [fetchDocuments])
  );

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
      <Text style={styles.sectionTitle}>Lease Document Vault</Text>
      <Text style={styles.sectionHint}>
        {leaseId ? `Documents for ${leaseTitle || 'your lease'}` : 'No pending or active lease found.'}
      </Text>
      {docs.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>
            {leaseId
              ? 'No documents uploaded for this lease yet.'
              : 'Documents will appear here once you have a pending or active lease.'}
          </Text>
        </View>
      ) : (
        docs.map((doc) => (
          <View key={doc.id} style={styles.card}>
            <View style={styles.rowHeader}>
              <FileText size={16} color="#38BDF8" />
              <Text style={styles.cardTitle}>{doc.title}</Text>
            </View>
            <Text style={styles.metaText}>Type: {doc.doc_type}</Text>
            <Text style={styles.metaText}>Added: {formatDate(doc.created_at)}</Text>
            <TouchableOpacity style={styles.linkBtn} onPress={() => openUrl(doc.file_url)}>
              <LinkIcon size={14} color="#0F172A" style={{ marginRight: 6 }} />
              <Text style={styles.linkBtnText}>Open Document</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Verified Payments & Receipts</Text>
      <Text style={styles.sectionHint}>Open PDF receipts when available after staff verification.</Text>
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
            {payment.proof_url ? (
              <TouchableOpacity style={styles.secondaryLink} onPress={() => openUrl(payment.proof_url!)}>
                <Text style={styles.secondaryLinkText}>View submitted proof</Text>
              </TouchableOpacity>
            ) : null}
            {payment.receipt_url ? (
              <TouchableOpacity style={styles.linkBtn} onPress={() => openUrl(payment.receipt_url!)}>
                <LinkIcon size={14} color="#0F172A" style={{ marginRight: 6 }} />
                <Text style={styles.linkBtnText}>Download PDF Receipt</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.emptyText}>PDF receipt not generated yet.</Text>
            )}
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
  cardTitle: { color: '#F8FAFC', marginLeft: 8, fontWeight: 'bold', fontSize: 14, flex: 1 },
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
  linkBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 13 },
  secondaryLink: { marginTop: 4, marginBottom: 4 },
  secondaryLinkText: { color: '#38BDF8', fontSize: 12, fontWeight: '600' },
});
