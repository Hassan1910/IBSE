import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
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
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalProperties: 0,
    occupiedUnits: 0,
    vacantUnits: 0,
    totalTenants: 0,
    monthlyIncome: 0,
    pendingPayments: 0,
  });
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // RLS automatically scopes every query below to the signed-in landlord.

      // Properties owned
      const { count: propCount } = await supabase
        .from('properties')
        .select('*', { count: 'exact', head: true });

      // Units (occupied vs vacant)
      const { data: units } = await supabase.from('units').select('status');
      const occupiedUnits = units?.filter((u) => u.status === 'occupied').length || 0;
      const vacantUnits = units?.filter((u) => u.status === 'vacant').length || 0;

      // Active leases -> tenants + monthly income
      const { data: leases } = await supabase
        .from('leases')
        .select('tenant_id, rent_amount')
        .eq('status', 'active');
      const tenantSet = new Set((leases || []).map((l) => l.tenant_id));
      const monthlyIncome = (leases || []).reduce((acc, l) => acc + Number(l.rent_amount || 0), 0);

      // Pending payments (scoped through the landlord's leases via RLS)
      const { data: pending } = await supabase
        .from('payments')
        .select('amount')
        .eq('status', 'pending');
      const pendingTotal = (pending || []).reduce((acc, p) => acc + Number(p.amount || 0), 0);

      setStats({
        totalProperties: propCount || 0,
        occupiedUnits,
        vacantUnits,
        totalTenants: tenantSet.size,
        monthlyIncome,
        pendingPayments: pendingTotal,
      });

      // Recent activity
      const { data: pay } = await supabase
        .from('payments')
        .select('id, amount, status, payment_date, profiles ( full_name )')
        .order('payment_date', { ascending: false })
        .limit(5);
      setRecentPayments((pay as any) || []);

      const { data: reqs } = await supabase
        .from('maintenance_requests')
        .select('id, title, status, created_at, properties ( title )')
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentRequests((reqs as any) || []);
    } catch (err) {
      console.error('Landlord dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchData} tintColor="#38BDF8" />}
    >
      <Text style={styles.sectionTitle}>Portfolio Overview</Text>

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
        <View style={[styles.incomeCard, styles.incomeCardLeft]}>
          <Wallet size={18} color="#10B981" />
          <Text style={styles.incomeLabel}>Monthly Income</Text>
          <Text style={styles.incomeValue}>{formatPrice(stats.monthlyIncome)}</Text>
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
          <View key={r.id} style={styles.activityRow}>
            <Wrench size={16} color="#94A3B8" style={styles.activityIcon} />
            <View style={styles.activityBody}>
              <Text style={styles.activityTitle}>{r.title}</Text>
              <Text style={styles.activitySub}>{r.properties?.title || 'Property'} • {formatDate(r.created_at)}</Text>
            </View>
            <Text style={[styles.activityStatus, { color: statusColor(r.status) }]}>
              {r.status.replace('_', ' ').toUpperCase()}
            </Text>
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
    marginBottom: 16,
  },
  incomeCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  incomeCardLeft: {
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
