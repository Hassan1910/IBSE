import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { Bell, Calendar, CreditCard, DollarSign, FileText, HelpCircle, Home, Wrench } from 'lucide-react-native';
import { useNotifications } from '../../hooks/useNotifications';

interface Lease {
  id: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  status: string;
  contract_url: string | null;
  terms: string | null;
  unit_id: string | null;
  properties: {
    title: string;
    location: string;
  };
  units: { unit_number: string } | null;
}

interface Payment {
  id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference_code: string;
  status: 'pending' | 'verified' | 'failed';
}

export default function TenantDashboard() {
  const router = useRouter();
  const { user } = useUser();
  const { unreadCount, refreshUnreadCount } = useNotifications();
  const [activeLease, setActiveLease] = useState<Lease | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [openMaintenance, setOpenMaintenance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      const [leaseRes, payRes, maintRes] = await Promise.all([
        supabase
          .from('leases')
          .select(`
            id,
            start_date,
            end_date,
            rent_amount,
            status,
            contract_url,
            terms,
            unit_id,
            properties ( title, location ),
            units ( unit_number )
          `)
          .eq('tenant_id', user.id)
          .eq('status', 'active')
          .maybeSingle(),
        supabase
          .from('payments')
          .select('id, amount, payment_date, payment_method, reference_code, status')
          .eq('payer_id', user.id)
          .order('payment_date', { ascending: false }),
        supabase
          .from('maintenance_requests')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', user.id)
          .neq('status', 'resolved'),
      ]);

      if (leaseRes.error) throw leaseRes.error;
      if (payRes.error) throw payRes.error;
      if (maintRes.error) throw maintRes.error;

      setActiveLease((leaseRes.data as any) || null);
      setPayments((payRes.data as any) || []);
      setOpenMaintenance(maintRes.count || 0);
    } catch (err: any) {
      console.error('Fetch tenant data error:', err);
      Alert.alert('Error', 'Failed to load lease and payment details.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchData(), refreshUnreadCount()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchData, refreshUnreadCount]);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(price);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'verified':
        return styles.statusVerified;
      case 'failed':
        return styles.statusFailed;
      default:
        return styles.statusPending;
    }
  };

  const currentMonthVerifiedPayments = useMemo(() => {
    const now = new Date();
    return payments
      .filter((p) => p.status === 'verified')
      .filter((p) => {
        const d = new Date(p.payment_date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, p) => sum + Number(p.amount), 0);
  }, [payments]);

  const outstandingBalance = Math.max((activeLease?.rent_amount || 0) - currentMonthVerifiedPayments, 0);
  const leaseDaysLeft = useMemo(() => {
    if (!activeLease?.end_date) return null;
    const diff = new Date(activeLease.end_date).getTime() - Date.now();
    return Math.max(Math.ceil(diff / (1000 * 60 * 60 * 24)), 0);
  }, [activeLease?.end_date]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38BDF8" />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Tenant Dashboard</Text>
        <TouchableOpacity style={styles.bellBtn} onPress={() => router.push('/(tenant)/notifications')}>
          <Bell size={18} color="#38BDF8" />
          {unreadCount > 0 ? (
            <View style={styles.badgeDot}>
              <Text style={styles.badgeDotText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <DollarSign size={16} color="#38BDF8" />
          <Text style={styles.statLabel}>Monthly Rent</Text>
          <Text style={styles.statValue}>{activeLease ? formatPrice(activeLease.rent_amount) : 'N/A'}</Text>
        </View>
        <View style={styles.statCard}>
          <CreditCard size={16} color="#EAB308" />
          <Text style={styles.statLabel}>Outstanding</Text>
          <Text style={[styles.statValue, { color: outstandingBalance > 0 ? '#EAB308' : '#10B981' }]}>{activeLease ? formatPrice(outstandingBalance) : 'N/A'}</Text>
        </View>
        <View style={styles.statCard}>
          <Wrench size={16} color={openMaintenance > 0 ? '#EAB308' : '#10B981'} />
          <Text style={styles.statLabel}>Open Tickets</Text>
          <Text style={[styles.statValue, { color: openMaintenance > 0 ? '#EAB308' : '#10B981' }]}>{openMaintenance}</Text>
        </View>
        <View style={styles.statCard}>
          <Calendar size={16} color={leaseDaysLeft !== null && leaseDaysLeft <= 30 ? '#EF4444' : '#38BDF8'} />
          <Text style={styles.statLabel}>Lease Days Left</Text>
          <Text style={[styles.statValue, { color: leaseDaysLeft !== null && leaseDaysLeft <= 30 ? '#EF4444' : '#38BDF8' }]}>
            {leaseDaysLeft === null ? 'N/A' : leaseDaysLeft}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Quick Access</Text>
      <View style={styles.quickGrid}>
        <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/(tenant)/agreements')}>
          <FileText size={16} color="#38BDF8" />
          <Text style={styles.quickText}>Agreement</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/(tenant)/documents')}>
          <FileText size={16} color="#10B981" />
          <Text style={styles.quickText}>Documents</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/(tenant)/feedback')}>
          <CreditCard size={16} color="#EAB308" />
          <Text style={styles.quickText}>Feedback</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/(tenant)/help')}>
          <HelpCircle size={16} color="#A78BFA" />
          <Text style={styles.quickText}>Help</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>My Active Lease</Text>
      {activeLease ? (
        <View style={styles.leaseCard}>
          <View style={styles.leaseHeader}>
            <Home size={24} color="#38BDF8" />
            <View style={styles.leaseTitleContainer}>
              <Text style={styles.leaseTitle}>{activeLease.properties?.title}</Text>
              <Text style={styles.leaseLoc}>{activeLease.properties?.location}</Text>
              {activeLease.units?.unit_number ? <Text style={styles.leaseLoc}>Unit: {activeLease.units.unit_number}</Text> : null}
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <DollarSign size={18} color="#38BDF8" style={styles.infoIcon} />
            <View>
              <Text style={styles.infoLabel}>Monthly Rent</Text>
              <Text style={styles.infoVal}>{formatPrice(activeLease.rent_amount)}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Calendar size={18} color="#38BDF8" style={styles.infoIcon} />
            <View>
              <Text style={styles.infoLabel}>Lease Period</Text>
              <Text style={styles.infoVal}>
                {formatDate(activeLease.start_date)} - {formatDate(activeLease.end_date)}
              </Text>
            </View>
          </View>
          {activeLease.contract_url ? <Text style={styles.infoHint}>Agreement document available in Documents.</Text> : null}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyCardText}>No active lease registered under your profile.</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Payment History</Text>
      {payments.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyCardText}>No payments recorded.</Text>
        </View>
      ) : (
        payments.map((item) => (
          <View key={item.id} style={styles.payCard}>
            <View style={styles.payHeader}>
              <View style={styles.payMethodRow}>
                <CreditCard size={18} color="#38BDF8" style={styles.payIcon} />
                <Text style={styles.payMethod}>{item.payment_method.toUpperCase()}</Text>
              </View>
              <View style={[styles.statusBadge, getStatusStyle(item.status)]}>
                <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.payBody}>
              <Text style={styles.payAmount}>{formatPrice(item.amount)}</Text>
              <Text style={styles.payRef}>Ref: {item.reference_code}</Text>
            </View>
            <Text style={styles.payDate}>{formatDate(item.payment_date)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeDotText: {
    color: '#F8FAFC',
    fontSize: 9,
    fontWeight: 'bold',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderColor: '#334155',
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    marginRight: '2%',
  },
  statLabel: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 6,
  },
  statValue: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 2,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  quickCard: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderColor: '#334155',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
    marginRight: '2%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickText: {
    color: '#F8FAFC',
    marginLeft: 8,
    fontWeight: '600',
    fontSize: 13,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 12,
    marginTop: 10,
  },
  leaseCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 24,
  },
  leaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaseTitleContainer: {
    marginLeft: 12,
    flex: 1,
  },
  leaseTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  leaseLoc: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoIcon: {
    marginRight: 12,
  },
  infoLabel: {
    fontSize: 11,
    color: '#94A3B8',
  },
  infoVal: {
    fontSize: 15,
    color: '#F8FAFC',
    fontWeight: '500',
    marginTop: 2,
  },
  infoHint: {
    color: '#94A3B8',
    fontSize: 12,
    fontStyle: 'italic',
  },
  emptyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 20,
    borderColor: '#334155',
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyCardText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  payCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 12,
  },
  payHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  payMethodRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  payIcon: {
    marginRight: 6,
  },
  payMethod: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusVerified: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  statusFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  statusPending: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  payBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  payAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#38BDF8',
  },
  payRef: {
    color: '#94A3B8',
    fontSize: 13,
  },
  payDate: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
  },
});
