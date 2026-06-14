import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { Home, Calendar, CreditCard, DollarSign } from 'lucide-react-native';

interface Lease {
  id: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  status: string;
  properties: {
    title: string;
    location: string;
  };
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
  const { user } = useUser();
  const [activeLease, setActiveLease] = useState<Lease | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // 1. Fetch active lease
      const { data: leaseData, error: leaseError } = await supabase
        .from('leases')
        .select(`
          id,
          start_date,
          end_date,
          rent_amount,
          status,
          properties ( title, location )
        `)
        .eq('tenant_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (leaseError) throw leaseError;
      setActiveLease((leaseData as any) || null);

      // 2. Fetch payments
      const { data: payData, error: payError } = await supabase
        .from('payments')
        .select('id, amount, payment_date, payment_method, reference_code, status')
        .eq('payer_id', user.id)
        .order('payment_date', { ascending: false });

      if (payError) throw payError;
      setPayments((payData as any) || []);
    } catch (err: any) {
      console.error('Fetch tenant data error:', err);
      Alert.alert('Error', 'Failed to load lease and payment details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Active Lease Section */}
      <Text style={styles.sectionTitle}>My Active Lease</Text>
      {activeLease ? (
        <View style={styles.leaseCard}>
          <View style={styles.leaseHeader}>
            <Home size={24} color="#38BDF8" />
            <View style={styles.leaseTitleContainer}>
              <Text style={styles.leaseTitle}>{activeLease.properties?.title}</Text>
              <Text style={styles.leaseLoc}>{activeLease.properties?.location}</Text>
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
                {formatDate(activeLease.start_date)} – {formatDate(activeLease.end_date)}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyCardText}>No active lease registered under your profile.</Text>
        </View>
      )}

      {/* Payment History Section */}
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
