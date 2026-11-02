import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { fetchLeaseBalance, leaseTotalRent } from '../../lib/leases';
import { Calendar, FileText, Home, Link as LinkIcon } from 'lucide-react-native';
import { openStorageUrl } from '../../lib/storage';

interface LeaseAgreement {
  id: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  status: string;
  terms: string | null;
  contract_url: string | null;
  properties: {
    title: string;
    location: string;
  };
  units: {
    unit_number: string;
  } | null;
}

export default function TenantAgreementsScreen() {
  const { user } = useUser();
  const [lease, setLease] = useState<LeaseAgreement | null>(null);
  const [chargesTotal, setChargesTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAgreement = async () => {
      if (!user?.id) return;
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('leases')
          .select(`
            id,
            start_date,
            end_date,
            rent_amount,
            status,
            terms,
            contract_url,
            properties ( title, location ),
            units ( unit_number )
          `)
          .eq('tenant_id', user.id)
          .in('status', ['pending', 'active'])
          .order('status', { ascending: true })
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        const row = (data as any as LeaseAgreement) || null;
        setLease(row);

        if (row?.id) {
          try {
            const balance = await fetchLeaseBalance(row.id);
            setChargesTotal(balance.charges_total);
          } catch (balanceErr) {
            console.error('Fetch lease balance error:', balanceErr);
            setChargesTotal(null);
          }
        } else {
          setChargesTotal(null);
        }
      } catch (err) {
        console.error('Fetch agreement error:', err);
        Alert.alert('Error', 'Failed to load your lease agreement.');
      } finally {
        setLoading(false);
      }
    };

    fetchAgreement();
  }, [user?.id]);

  const openContract = async () => {
    if (!lease?.contract_url) return;
    try {
      await openStorageUrl(lease.contract_url);
    } catch {
      Alert.alert('Invalid URL', 'Could not open this contract link.');
    }
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(price);
  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });

  const daysLeft = lease ? Math.max(Math.ceil((new Date(lease.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)), 0) : null;
  const leaseTotalDisplay = lease
    ? (chargesTotal ?? leaseTotalRent(lease.rent_amount, lease.start_date, lease.end_date))
    : 0;
  const hasContract = !!lease?.contract_url;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  if (!lease) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No pending or active lease agreement found for your account.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Home size={20} color="#38BDF8" />
          <View style={styles.headerText}>
            <Text style={styles.title}>{lease.properties?.title}</Text>
            <Text style={styles.sub}>{lease.properties?.location}</Text>
            {lease.units?.unit_number ? <Text style={styles.sub}>Unit {lease.units.unit_number}</Text> : null}
            {lease.status === 'pending' ? <Text style={styles.pendingBadge}>PENDING PAYMENT</Text> : null}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Monthly Rent</Text>
          <Text style={styles.value}>{formatPrice(lease.rent_amount)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Lease Total</Text>
          <Text style={styles.value}>{formatPrice(leaseTotalDisplay)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Start Date</Text>
          <Text style={styles.value}>{formatDate(lease.start_date)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>End Date</Text>
          <Text style={styles.value}>{formatDate(lease.end_date)}</Text>
        </View>
      </View>

      {daysLeft !== null && daysLeft <= 30 && lease.status === 'active' ? (
        <View style={styles.warningCard}>
          <Calendar size={16} color="#EF4444" />
          <Text style={styles.warningText}>
            Your lease expires in {daysLeft} day(s). Use Feedback or Help for renewal guidance.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <FileText size={16} color="#38BDF8" />
          <Text style={styles.sectionTitle}>Lease Terms</Text>
        </View>
        <Text style={styles.termsText}>{lease.terms || 'No written terms were provided in the system.'}</Text>
      </View>

      <TouchableOpacity
        style={[styles.linkBtn, !hasContract && styles.linkBtnDisabled]}
        onPress={openContract}
        disabled={!hasContract}
      >
        <LinkIcon size={16} color={hasContract ? '#0F172A' : '#64748B'} style={{ marginRight: 8 }} />
        <Text style={[styles.linkBtnText, !hasContract && styles.linkBtnTextDisabled]}>
          {hasContract ? 'Open Lease Document' : 'No Contract URL Available'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 20, paddingBottom: 30 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A', padding: 20 },
  emptyText: { color: '#94A3B8', textAlign: 'center', fontSize: 14 },
  card: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  headerText: { marginLeft: 10, flex: 1 },
  title: { color: '#F8FAFC', fontSize: 16, fontWeight: 'bold' },
  sub: { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  pendingBadge: {
    color: '#EAB308',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
    letterSpacing: 0.4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  label: { color: '#94A3B8', fontSize: 13 },
  value: { color: '#F8FAFC', fontWeight: '600' },
  warningCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  warningText: { color: '#FECACA', marginLeft: 8, flex: 1, fontSize: 13 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { color: '#F8FAFC', marginLeft: 8, fontWeight: 'bold', fontSize: 14 },
  termsText: { color: '#CBD5E1', lineHeight: 21, fontSize: 14 },
  linkBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingVertical: 14,
  },
  linkBtnDisabled: {
    backgroundColor: '#334155',
  },
  linkBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 14 },
  linkBtnTextDisabled: { color: '#64748B' },
});
