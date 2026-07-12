import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-expo';
import {
  Home,
  DoorOpen,
  DoorClosed,
  Users,
  Wallet,
  Clock,
  CreditCard,
  Wrench,
  ChevronRight,
  MessageSquare,
} from 'lucide-react-native';
import NotificationBell from '../../components/NotificationBell';
import { useLandlordDashboard } from '../../hooks/queries/useDashboard';
import { queryKeys } from '../../hooks/queries/keys';

interface RecentPayment {
  id: string;
  amount: number;
  status: string;
  payment_date: string;
  profiles: { full_name: string } | null;
}

interface RecentRequest {
  id: string;
  title: string;
  status: string;
  created_at: string;
  properties: { title: string } | null;
}

export default function LandlordDashboard() {
  const router = useRouter();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const { statsQuery, recentQuery } = useLandlordDashboard(userId);

  const stats = useMemo(
    () => ({
      totalProperties: Number(statsQuery.data?.total_properties ?? 0),
      occupiedUnits: Number(statsQuery.data?.occupied_units ?? 0),
      vacantUnits: Number(statsQuery.data?.vacant_units ?? 0),
      totalTenants: Number(statsQuery.data?.total_tenants ?? 0),
      monthlyIncome: Number(statsQuery.data?.monthly_income ?? 0),
      verifiedCollected: Number(statsQuery.data?.verified_collected ?? 0),
      pendingPayments: Number(statsQuery.data?.pending_payments ?? 0),
    }),
    [statsQuery.data]
  );

  const recentPayments = (recentQuery.data?.recentPayments as RecentPayment[]) || [];
  const recentRequests = (recentQuery.data?.recentRequests as RecentRequest[]) || [];

  const hasData = !!statsQuery.data || !!recentQuery.data;
  const hasError = statsQuery.isError || recentQuery.isError;
  const loading =
    !userId ||
    ((statsQuery.isLoading && !statsQuery.data) ||
      (recentQuery.isLoading && !recentQuery.data));
  const refreshing =
    (statsQuery.isRefetching || recentQuery.isRefetching) &&
    !statsQuery.isLoading &&
    !recentQuery.isLoading;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      const state = queryClient.getQueryState(queryKeys.landlordDashboard(userId));
      const age = state?.dataUpdatedAt ? Date.now() - state.dataUpdatedAt : Infinity;
      if (age > 30_000) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.landlordDashboard(userId) });
      }
    }, [queryClient, userId])
  );

  useEffect(() => {
    if (!hasError) return;
    console.error(
      'Fetch landlord dashboard error:',
      statsQuery.error || recentQuery.error
    );
  }, [hasError, statsQuery.error, recentQuery.error]);

  const onRefresh = () => {
    void Promise.all([statsQuery.refetch(), recentQuery.refetch()]);
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0,
    }).format(price);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-KE', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const statusColor = (status: string) => {
    switch (status) {
      case 'verified':
      case 'resolved':
        return '#10B981';
      case 'pending':
        return '#EAB308';
      case 'in_progress':
        return '#38BDF8';
      case 'failed':
        return '#EF4444';
      default:
        return '#94A3B8';
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  if (hasError && !hasData) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load dashboard data.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38BDF8" />}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.sectionTitle, { marginBottom: 0, marginTop: 0, flex: 1 }]}>Portfolio Overview</Text>
        <NotificationBell href="/(landlord)/notifications" />
      </View>

      <View style={styles.grid}>
        <View style={styles.statCard}>
          <Home size={20} color="#38BDF8" />
          <Text style={styles.statValue}>{stats.totalProperties}</Text>
          <Text style={styles.statLabel}>Properties</Text>
        </View>
        <View style={styles.statCard}>
          <DoorClosed size={20} color="#10B981" />
          <Text style={styles.statValue}>{stats.occupiedUnits}</Text>
          <Text style={styles.statLabel}>Occupied</Text>
        </View>
        <View style={styles.statCard}>
          <DoorOpen size={20} color="#EAB308" />
          <Text style={styles.statValue}>{stats.vacantUnits}</Text>
          <Text style={styles.statLabel}>Vacant</Text>
        </View>
        <View style={styles.statCard}>
          <Users size={20} color="#38BDF8" />
          <Text style={styles.statValue}>{stats.totalTenants}</Text>
          <Text style={styles.statLabel}>Tenants</Text>
        </View>
      </View>

      <View style={styles.incomeRow}>
        <View style={[styles.incomeCard, styles.incomeCardGap]}>
          <Wallet size={18} color="#10B981" />
          <Text style={styles.incomeLabel}>Expected Monthly Rent</Text>
          <Text style={styles.incomeValue}>{formatPrice(stats.monthlyIncome)}</Text>
        </View>
        <View style={[styles.incomeCard, styles.incomeCardGap]}>
          <CreditCard size={18} color="#38BDF8" />
          <Text style={styles.incomeLabel}>Collected (all time)</Text>
          <Text style={[styles.incomeValue, { color: '#38BDF8' }]}>{formatPrice(stats.verifiedCollected)}</Text>
        </View>
        <View style={styles.incomeCard}>
          <Clock size={18} color="#EAB308" />
          <Text style={styles.incomeLabel}>Pending Payments</Text>
          <Text style={[styles.incomeValue, { color: '#EAB308' }]}>{formatPrice(stats.pendingPayments)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.linkCard} onPress={() => router.push('/(landlord)/payments')}>
        <CreditCard size={18} color="#38BDF8" style={styles.linkIcon} />
        <Text style={styles.linkText}>View & verify rent payments</Text>
        <ChevronRight size={18} color="#94A3B8" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkCard} onPress={() => router.push('/(landlord)/reports')}>
        <Wallet size={18} color="#38BDF8" style={styles.linkIcon} />
        <Text style={styles.linkText}>Income & occupancy reports</Text>
        <ChevronRight size={18} color="#94A3B8" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkCard} onPress={() => router.push('/(landlord)/messages')}>
        <MessageSquare size={18} color="#38BDF8" style={styles.linkIcon} />
        <Text style={styles.linkText}>Message tenants</Text>
        <ChevronRight size={18} color="#94A3B8" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkCard} onPress={() => router.push('/(landlord)/agreements')}>
        <Home size={18} color="#38BDF8" style={styles.linkIcon} />
        <Text style={styles.linkText}>Manage rental agreements</Text>
        <ChevronRight size={18} color="#94A3B8" />
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Recent Payment Activity</Text>
      {recentPayments.length === 0 ? (
        <Text style={styles.emptyText}>No recent payments.</Text>
      ) : (
        recentPayments.map((p) => (
          <View key={p.id} style={styles.activityRow}>
            <CreditCard size={16} color="#94A3B8" style={styles.activityIcon} />
            <View style={styles.activityBody}>
              <Text style={styles.activityTitle}>{p.profiles?.full_name || 'Tenant'}</Text>
              <Text style={styles.activitySub}>{formatDate(p.payment_date)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.activityAmount}>{formatPrice(p.amount)}</Text>
              <Text style={[styles.activityStatus, { color: statusColor(p.status) }]}>
                {p.status.toUpperCase()}
              </Text>
            </View>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Recent Maintenance</Text>
      {recentRequests.length === 0 ? (
        <Text style={styles.emptyText}>No recent maintenance requests.</Text>
      ) : (
        recentRequests.map((r) => (
          <TouchableOpacity
            key={r.id}
            style={styles.activityRow}
            activeOpacity={0.7}
            onPress={() =>
              router.push({ pathname: '/(landlord)/maintenance', params: { id: r.id } })
            }
          >
            <Wrench size={16} color="#94A3B8" style={styles.activityIcon} />
            <View style={styles.activityBody}>
              <Text style={styles.activityTitle}>{r.title}</Text>
              <Text style={styles.activitySub}>{r.properties?.title || 'Property'} • {formatDate(r.created_at)}</Text>
            </View>
            <Text style={[styles.activityStatus, { color: statusColor(r.status) }]}>
              {r.status.replace('_', ' ').toUpperCase()}
            </Text>
            <ChevronRight size={16} color="#64748B" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
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
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#F8FAFC',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#0F172A',
    fontWeight: '600',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginTop: 8,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  incomeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  incomeCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 140,
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  incomeCardGap: {
    marginRight: 12,
  },
  incomeLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 8,
  },
  incomeValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#10B981',
    marginTop: 4,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  linkIcon: {
    marginRight: 12,
  },
  linkText: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '500',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  activityIcon: {
    marginRight: 12,
  },
  activityBody: {
    flex: 1,
  },
  activityTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  activitySub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  activityAmount: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
  },
  activityStatus: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 12,
  },
});
