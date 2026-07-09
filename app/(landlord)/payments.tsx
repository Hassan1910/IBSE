import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { logAudit } from '../../lib/audit';
import { CreditCard, User as UserIcon, Check, X, Bell, Wallet } from 'lucide-react-native';

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  reference_code: string;
  payment_date: string;
  status: 'pending' | 'verified' | 'failed';
  profiles: { full_name: string; email: string } | null;
  leases: { end_date: string; properties: { title: string } | null } | null;
}

type Filter = 'pending' | 'verified' | 'all';

export default function LandlordPayments() {
  const { user } = useUser();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('pending');
  const [totals, setTotals] = useState({ collected: 0, pending: 0 });

  const fetchPayments = useCallback(async () => {
    try {
      setLoading(true);
      // RLS returns only payments on leases owned by this landlord.
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, payment_method, reference_code, payment_date, status, profiles:payer_id ( full_name, email ), leases ( end_date, properties ( title ) )')
        .order('payment_date', { ascending: false });
      if (error) throw error;
      const rows = (data as any as Payment[]) || [];
      setPayments(rows);

      const collected = rows.filter((p) => p.status === 'verified').reduce((a, p) => a + Number(p.amount), 0);
      const pending = rows.filter((p) => p.status === 'pending').reduce((a, p) => a + Number(p.amount), 0);
      setTotals({ collected, pending });
    } catch (err) {
      console.error('Fetch payments error:', err);
      Alert.alert('Error', 'Failed to load payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleVerify = async (id: string, action: 'verified' | 'failed') => {
    try {
      const { error } = await supabase.from('payments').update({ status: action }).eq('id', id);
      if (error) throw error;
      logAudit({ actorId: user?.id || '', action: 'update', entityType: 'payment', entityId: id, description: `Payment marked ${action}` });
      Alert.alert('Success', `Payment marked as ${action === 'verified' ? 'verified' : 'failed'}.`);
      fetchPayments();
    } catch (err) {
      console.error('Verify payment error:', err);
      Alert.alert('Error', 'Failed to update payment status.');
    }
  };

  const handleReminder = (p: Payment) => {
    Alert.alert(
      'Send Payment Reminder',
      `Send a rent reminder to ${p.profiles?.full_name || 'the tenant'} (${p.profiles?.email || 'no email'})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: () => {
            logAudit({ actorId: user?.id || '', action: 'notify', entityType: 'payment', entityId: p.id, description: 'Sent payment reminder' });
            Alert.alert('Reminder Sent', 'The tenant has been reminded about this payment.');
          },
        },
      ],
    );
  };

  const formatPrice = (p: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(p);
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const isOverdue = (p: Payment) =>
    p.status === 'pending' && p.leases?.end_date && new Date(p.leases.end_date) < new Date();

  const filtered = payments.filter((p) => (filter === 'all' ? true : p.status === filter));

  const statusColor = (s: string) => (s === 'verified' ? '#10B981' : s === 'pending' ? '#EAB308' : '#EF4444');

  const renderHeader = () => (
    <View>
      <View style={styles.totalsRow}>
        <View style={[styles.totalCard, { marginRight: 12 }]}>
          <Wallet size={18} color="#10B981" />
          <Text style={styles.totalLabel}>Collected</Text>
          <Text style={styles.totalValue}>{formatPrice(totals.collected)}</Text>
        </View>
        <View style={styles.totalCard}>
          <CreditCard size={18} color="#EAB308" />
          <Text style={styles.totalLabel}>Pending</Text>
          <Text style={[styles.totalValue, { color: '#EAB308' }]}>{formatPrice(totals.pending)}</Text>
        </View>
      </View>

      <View style={styles.segment}>
        {(['pending', 'verified', 'all'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.segmentBtn, filter === f && styles.segmentBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.segmentText, filter === f && styles.segmentTextActive]}>{f.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.propTitle}>{item.leases?.properties?.title || 'Rent Payment'}</Text>
                <View style={[styles.badge, { borderColor: statusColor(item.status) }]}>
                  <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
                </View>
              </View>

              <Text style={styles.amount}>{formatPrice(item.amount)}</Text>
              <Text style={styles.refCode}>
                {item.payment_method.toUpperCase()} • Ref: <Text style={styles.boldText}>{item.reference_code}</Text>
              </Text>

              {isOverdue(item) ? <Text style={styles.overdue}>OVERDUE</Text> : null}

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <UserIcon size={16} color="#38BDF8" style={styles.icon} />
                <View>
                  <Text style={styles.clientName}>{item.profiles?.full_name || 'Tenant'}</Text>
                  <Text style={styles.clientEmail}>{item.profiles?.email}</Text>
                </View>
              </View>

              <Text style={styles.dateText}>Submitted: {formatDate(item.payment_date)}</Text>

              {item.status === 'pending' ? (
                <>
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleVerify(item.id, 'failed')}>
                      <X size={16} color="#EF4444" style={styles.btnIcon} />
                      <Text style={styles.rejectText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleVerify(item.id, 'verified')}>
                      <Check size={16} color="#0F172A" style={styles.btnIcon} />
                      <Text style={styles.approveText}>Verify</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.reminderRow} onPress={() => handleReminder(item)}>
                    <Bell size={14} color="#94A3B8" style={styles.btnIcon} />
                    <Text style={styles.reminderText}>Send reminder</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          )}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchPayments}
          refreshing={loading}
          ListEmptyComponent={
            <View style={styles.emptyCentered}>
              <CreditCard size={48} color="#94A3B8" style={styles.emptyIcon} />
              <Text style={styles.emptyText}>No payments in this view.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  listContainer: { padding: 16, flexGrow: 1 },
  totalsRow: { flexDirection: 'row', marginBottom: 16 },
  totalCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  totalLabel: { color: '#94A3B8', fontSize: 12, marginTop: 8 },
  totalValue: { color: '#10B981', fontSize: 18, fontWeight: 'bold', marginTop: 4 },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 4,
    marginBottom: 16,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  segmentBtnActive: { backgroundColor: 'rgba(56, 189, 248, 0.1)', borderColor: 'rgba(56, 189, 248, 0.2)', borderWidth: 1 },
  segmentText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  segmentTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  propTitle: { fontSize: 15, fontWeight: 'bold', color: '#94A3B8', flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: 'bold' },
  amount: { fontSize: 24, fontWeight: 'bold', color: '#F8FAFC', marginVertical: 6 },
  refCode: { color: '#38BDF8', fontSize: 14, fontWeight: '500' },
  boldText: { color: '#F8FAFC', fontWeight: 'bold' },
  overdue: { color: '#EF4444', fontSize: 12, fontWeight: 'bold', marginTop: 6 },
  divider: { height: 1, backgroundColor: '#334155', marginVertical: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  icon: { marginRight: 10 },
  clientName: { color: '#F8FAFC', fontSize: 14, fontWeight: '600' },
  clientEmail: { color: '#94A3B8', fontSize: 12 },
  dateText: { fontSize: 11, color: '#64748B', marginBottom: 14 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  rejectBtn: { borderColor: '#EF4444', borderWidth: 1, marginRight: 8 },
  approveBtn: { backgroundColor: '#38BDF8', marginLeft: 8 },
  btnIcon: { marginRight: 6 },
  rejectText: { color: '#EF4444', fontWeight: 'bold' },
  approveText: { color: '#0F172A', fontWeight: 'bold' },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  reminderText: { color: '#94A3B8', fontSize: 12, fontWeight: '500' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCentered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, marginTop: 60 },
  emptyIcon: { marginBottom: 12 },
  emptyText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
});
