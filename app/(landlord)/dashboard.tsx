import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
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
} from 'lucide-react-native';
import NotificationBell from '../../components/NotificationBell';

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);
  const [stats, setStats] = useState({
    totalProperties: 0,
    occupiedUnits: 0,
    vacantUnits: 0,
    totalTenants: 0,
    monthlyIncome: 0,
    verifiedCollected: 0,
    pendingPayments: 0,
  });
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id) return;
    try {
      if (opts?.silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      // Scope everything through properties the landlord owns so stats stay
      // correct even when denormalized leases/units.owner_id is stale.
      const { data: ownedProps, error: propsError } = await supabase
        .from('properties')
        .select('id, status')
        .eq('owner_id', user.id);
      if (propsError) throw propsError;

      const propIds = (ownedProps || []).map((p) => p.id);
      const propCount = propIds.length;

      let occupiedUnits = 0;
      let vacantUnits = 0;
      let totalTenants = 0;
      let monthlyIncome = 0;
      let verifiedCollected = 0;
      let pendingTotal = 0;

      if (propIds.length > 0) {
        const { data: units, error: unitsError } = await supabase
          .from('units')
          .select('status, property_id')
          .in('property_id', propIds);
        if (unitsError) throw unitsError;

        occupiedUnits = units?.filter((u) => u.status === 'occupied').length || 0;
        vacantUnits = units?.filter((u) => u.status === 'vacant').length || 0;

        const { data: leases, error: leasesError } = await supabase
          .from('leases')
          .select('id, tenant_id, rent_amount, unit_id, property_id, status')
          .in('status', ['pending', 'active'])
          .in('property_id', propIds);
        if (leasesError) throw leasesError;

        const activeLeases = (leases || []).filter((l) => l.status === 'active');
        const payableLeases = leases || [];
        totalTenants = new Set(activeLeases.map((l) => l.tenant_id)).size;
        monthlyIncome = activeLeases.reduce((acc, l) => acc + Number(l.rent_amount || 0), 0);

        // Properties without a units inventory: occupied when they have an
        // active lease, otherwise vacant. (Vacant previously only counted
        // unit rows, so freeing a unitless rental left Vacant at 0.)
        const propertiesWithUnits = new Set((units || []).map((u) => u.property_id));
        const leasedPropertyIds = new Set(activeLeases.map((l) => l.property_id));
        const unitlessProps = (ownedProps || []).filter((p) => !propertiesWithUnits.has(p.id));
        const unitlessOccupied = unitlessProps.filter((p) => leasedPropertyIds.has(p.id)).length;
        const unitlessVacant = unitlessProps.length - unitlessOccupied;
        occupiedUnits += unitlessOccupied;
        vacantUnits += unitlessVacant;

        const leaseIds = payableLeases.map((l) => l.id);
        if (leaseIds.length > 0) {
          const { data: pending, error: pendingError } = await supabase
            .from('payments')
            .select('amount')
            .eq('status', 'pending')
            .in('lease_id', leaseIds);
          if (pendingError) throw pendingError;
          pendingTotal = (pending || []).reduce((acc, p) => acc + Number(p.amount || 0), 0);

          const { data: verified, error: verifiedError } = await supabase
            .from('payments')
            .select('amount')
            .eq('status', 'verified')
            .in('lease_id', leaseIds);
          if (verifiedError) throw verifiedError;
          verifiedCollected = (verified || []).reduce((acc, p) => acc + Number(p.amount || 0), 0);

          const { data: pay, error: payError } = await supabase
            .from('payments')
            .select('id, amount, status, payment_date, lease_id, profiles:payer_id ( full_name )')
            .in('lease_id', leaseIds)
            .order('payment_date', { ascending: false })
            .limit(5);
          if (payError) throw payError;
          setRecentPayments((pay as any) || []);
        } else {
          setRecentPayments([]);
        }
      } else {
        setRecentPayments([]);
      }

      setStats({
        totalProperties: propCount,
        occupiedUnits,
        vacantUnits,
        totalTenants,
        monthlyIncome,
        verifiedCollected,
        pendingPayments: pendingTotal,
      });

      const { data: reqs, error: reqsError } = await supabase
        .from('maintenance_requests')
        .select('id, title, status, created_at, properties!inner ( title, owner_id )')
        .eq('properties.owner_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      if (reqsError) throw reqsError;
      setRecentRequests((reqs as any) || []);
    } catch (err) {
      console.error('Landlord dashboard fetch error:', err);
      Alert.alert('Error', 'Failed to load dashboard data.');
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  // Tab screens stay mounted, so refetch whenever this screen is focused
  // (e.g. after adding a property on another tab).
  useFocusEffect(
    useCallback(() => {
      fetchData({ silent: hasLoadedRef.current });
    }, [fetchData])
  );

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
      default:
        return '#EF4444';
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchData({ silent: true })} tintColor="#38BDF8" />}
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
          <Text style={styles.incomeLabel}>Verified Collected</Text>
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
