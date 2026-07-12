import React, { useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { leaseTotalRent, fetchLeaseBalance } from '../../lib/leases';
import { useUser } from '@clerk/clerk-expo';
import { Calendar, CreditCard, DollarSign, FileText, HelpCircle, Home, MessageSquare, Wrench } from 'lucide-react-native';
import { useNotifications } from '../../hooks/useNotifications';
import { fetchTenantDashboard } from '../../hooks/queries/fetchers';
import { queryKeys } from '../../hooks/queries/keys';

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
  lease_id: string | null;
}

export default function TenantDashboard() {
  const router = useRouter();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { refreshUnreadCount } = useNotifications();
  const userId = user?.id || '';

  const dashboardQuery = useQuery({
    queryKey: queryKeys.tenantDashboard(userId),
    queryFn: () => fetchTenantDashboard(userId),
    enabled: !!userId,
  });

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void refreshUnreadCount();
      const state = queryClient.getQueryState(queryKeys.tenantDashboard(userId));
      const age = state?.dataUpdatedAt ? Date.now() - state.dataUpdatedAt : Infinity;
      if (age > 30_000) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tenantDashboard(userId) });
      }
    }, [queryClient, userId, refreshUnreadCount])
  );

  useEffect(() => {
    if (dashboardQuery.isError) {
      console.error('Fetch tenant data error:', dashboardQuery.error);
      Alert.alert('Error', 'Failed to load lease and payment details.');
    }
  }, [dashboardQuery.isError, dashboardQuery.error]);

  const leases = (dashboardQuery.data?.leases as any as Lease[]) || [];
  const payments = (dashboardQuery.data?.payments as any as Payment[]) || [];
  const openMaintenance = dashboardQuery.data?.openMaintenance ?? 0;
  const activeLease = leases.find((l) => l.status === 'active') || null;
  const pendingLease = leases.find((l) => l.status === 'pending') || null;
  const balanceLeaseId = activeLease?.id || pendingLease?.id || null;

  const balanceQuery = useQuery({
    queryKey: ['tenant', 'balance', balanceLeaseId],
    queryFn: () => fetchLeaseBalance(balanceLeaseId!),
    enabled: !!balanceLeaseId,
  });

  const loading = dashboardQuery.isLoading && !dashboardQuery.data;
  const refreshing = dashboardQuery.isRefetching && !dashboardQuery.isLoading;

  const onRefresh = useCallback(async () => {
    await Promise.all([
      dashboardQuery.refetch(),
      balanceQuery.refetch(),
      refreshUnreadCount(),
    ]);
  }, [dashboardQuery, balanceQuery, refreshUnreadCount]);

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

  const currentLease = activeLease || pendingLease;
  const currentLeaseId = currentLease?.id || null;

  const leaseTotal = balanceQuery.data?.charges_total
    ?? (currentLease
      ? leaseTotalRent(currentLease.rent_amount, currentLease.start_date, currentLease.end_date)
      : 0);

  const verifiedPaymentsTotal = balanceQuery.data?.paid_total
    ?? (currentLease
      ? payments
          .filter((p) => p.status === 'verified' && p.lease_id === currentLease.id)
          .reduce((sum, p) => sum + Number(p.amount), 0)
      : 0);

  const outstandingBalance = balanceQuery.data?.outstanding
    ?? Math.max(leaseTotal - verifiedPaymentsTotal, 0);
  const leaseScopedPayments = useMemo(() => {
    if (!currentLeaseId) return payments;
    return payments.filter((p) => p.lease_id === currentLeaseId);
  }, [payments, currentLeaseId]);
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
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <DollarSign size={16} color="#38BDF8" />
          <Text style={styles.statLabel}>Charges Total</Text>
          <Text style={styles.statValue}>{balanceLeaseId ? formatPrice(leaseTotal) : 'N/A'}</Text>
        </View>
        <View style={styles.statCard}>
          <CreditCard size={16} color="#EAB308" />
          <Text style={styles.statLabel}>Outstanding</Text>
          <Text style={[styles.statValue, { color: outstandingBalance > 0 ? '#EAB308' : '#10B981' }]}>{balanceLeaseId ? formatPrice(outstandingBalance) : 'N/A'}</Text>
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
        <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/(tenant)/messages')}>
          <MessageSquare size={16} color="#38BDF8" />
          <Text style={styles.quickText}>Messages</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickCard} onPress={() => router.push('/(tenant)/feedback')}>
          <MessageSquare size={16} color="#EAB308" />
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
              <Text style={styles.infoLabel}>Lease Total</Text>
              <Text style={styles.infoVal}>{formatPrice(leaseTotal)}</Text>
              <Text style={styles.infoHint}>
                {formatPrice(activeLease.rent_amount)}/month · {formatPrice(verifiedPaymentsTotal)} verified paid
              </Text>
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
      ) : pendingLease ? (
        <View style={styles.leaseCard}>
          <View style={styles.leaseHeader}>
            <Home size={24} color="#EAB308" />
            <View style={styles.leaseTitleContainer}>
              <Text style={styles.leaseTitle}>{pendingLease.properties?.title}</Text>
              <Text style={styles.leaseLoc}>{pendingLease.properties?.location}</Text>
              {pendingLease.units?.unit_number ? (
                <Text style={styles.leaseLoc}>Unit: {pendingLease.units.unit_number}</Text>
              ) : null}
              <Text style={styles.pendingBadge}>PENDING PAYMENT</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <Text style={styles.pendingCopy}>
            Your lease is assigned but not active yet. Submit rent payment, then wait for your landlord to verify it.
          </Text>
          <TouchableOpacity style={styles.payCta} onPress={() => router.push('/(tenant)/rent')}>
            <CreditCard size={16} color="#0F172A" style={{ marginRight: 8 }} />
            <Text style={styles.payCtaText}>Submit Rent Payment</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyCardText}>No active lease registered under your profile.</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Payment History</Text>
      {leaseScopedPayments.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyCardText}>No payments recorded for your current lease.</Text>
        </View>
      ) : (
        leaseScopedPayments.map((item) => (
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
  pendingBadge: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: '#EAB308',
    letterSpacing: 0.4,
  },
  pendingCopy: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 19,
    marginBottom: 14,
  },
  payCta: {
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  payCtaText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
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
