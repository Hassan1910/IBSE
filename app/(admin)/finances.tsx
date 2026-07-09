import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { useAudit } from '../../hooks/useAudit';
import { Plus, X, Trash2, Edit2, TrendingUp, TrendingDown, Wallet } from 'lucide-react-native';

type ExpenseCategory = 'maintenance' | 'utilities' | 'salaries' | 'supplies' | 'marketing' | 'other';

interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  incurred_on: string;
}

const CATEGORIES: ExpenseCategory[] = [
  'maintenance',
  'utilities',
  'salaries',
  'supplies',
  'marketing',
  'other',
];

export default function AdminFinancesScreen() {
  const { user } = useUser();
  const { log } = useAudit();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [revenue, setRevenue] = useState(0);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState<ExpenseCategory>('maintenance');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0,
    }).format(price);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [expRes, payRes] = await Promise.all([
        supabase.from('expenses').select('*').order('incurred_on', { ascending: false }),
        supabase.from('payments').select('amount').eq('status', 'verified'),
      ]);

      if (expRes.error) throw expRes.error;
      setExpenses((expRes.data as Expense[]) || []);
      const rev = (payRes.data || []).reduce((acc, p) => acc + Number(p.amount), 0);
      setRevenue(rev);
    } catch (err) {
      console.error('Fetch finances error:', err);
      Alert.alert('Error', 'Failed to load financial records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalExpenses = expenses.reduce((acc, e) => acc + Number(e.amount), 0);
  const net = revenue - totalExpenses;

  const resetForm = () => {
    setEditingId(null);
    setCategory('maintenance');
    setDescription('');
    setAmount('');
    setIncurredOn('');
  };

  const openEdit = (item: Expense) => {
    setEditingId(item.id);
    setCategory(item.category);
    setDescription(item.description);
    setAmount(String(item.amount));
    setIncurredOn(item.incurred_on);
    setModalVisible(true);
  };

  const handleDelete = (item: Expense) => {
    Alert.alert('Delete Expense', `Remove "${item.description}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('expenses').delete().eq('id', item.id);
            if (error) throw error;
            setExpenses((prev) => prev.filter((e) => e.id !== item.id));
            log({ action: 'delete', entityType: 'expense', entityId: item.id, description: item.description });
          } catch (err) {
            console.error('Delete expense error:', err);
            Alert.alert('Error', 'Failed to delete expense.');
          }
        },
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!description.trim() || !amount) {
      Alert.alert('Validation Error', 'Please enter a description and amount.');
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 0) {
      Alert.alert('Validation Error', 'Please enter a valid amount.');
      return;
    }

    const payload = {
      category,
      description: description.trim(),
      amount: numAmount,
      incurred_on: incurredOn.trim() || new Date().toISOString().slice(0, 10),
    };

    try {
      setSubmitting(true);
      if (editingId) {
        const { error } = await supabase.from('expenses').update(payload).eq('id', editingId);
        if (error) throw error;
        log({ action: 'update', entityType: 'expense', entityId: editingId, description: payload.description });
      } else {
        const { error } = await supabase
          .from('expenses')
          .insert({ ...payload, created_by: user?.id ?? null });
        if (error) throw error;
        log({ action: 'create', entityType: 'expense', description: payload.description });
      }
      setModalVisible(false);
      resetForm();
      fetchData();
    } catch (err) {
      console.error('Save expense error:', err);
      Alert.alert('Error', 'Failed to save expense.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderHeader = () => (
    <View>
      <View style={styles.summaryRow}>
        <View style={[styles.summaryBox, { borderColor: 'rgba(16,185,129,0.4)' }]}>
          <TrendingUp size={18} color="#10B981" />
          <Text style={styles.summaryLabel}>Revenue</Text>
          <Text style={[styles.summaryVal, { color: '#10B981' }]}>{formatPrice(revenue)}</Text>
        </View>
        <View style={[styles.summaryBox, { borderColor: 'rgba(239,68,68,0.4)' }]}>
          <TrendingDown size={18} color="#EF4444" />
          <Text style={styles.summaryLabel}>Expenses</Text>
          <Text style={[styles.summaryVal, { color: '#EF4444' }]}>{formatPrice(totalExpenses)}</Text>
        </View>
      </View>

      <View style={styles.netBox}>
        <Wallet size={20} color="#38BDF8" />
        <View style={{ marginLeft: 12 }}>
          <Text style={styles.summaryLabel}>Net Position</Text>
          <Text style={[styles.netVal, { color: net >= 0 ? '#10B981' : '#EF4444' }]}>
            {formatPrice(net)}
          </Text>
        </View>
      </View>

      <Text style={styles.listTitle}>Recorded Expenses</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          <FlatList
            data={expenses}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={renderHeader}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardInfo}>
                  <Text style={styles.itemName}>{item.description}</Text>
                  <Text style={styles.subText}>
                    {item.category.toUpperCase()} • {item.incurred_on}
                  </Text>
                  <Text style={styles.amount}>{formatPrice(Number(item.amount))}</Text>
                </View>
                <View style={styles.actionGrid}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
                    <Edit2 size={16} color="#38BDF8" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.deleteBtn]}
                    onPress={() => handleDelete(item)}
                  >
                    <Trash2 size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
            contentContainerStyle={styles.listContainer}
            onRefresh={fetchData}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <Wallet size={48} color="#94A3B8" style={{ marginBottom: 12 }} />
                <Text style={styles.emptyText}>No expenses recorded yet.</Text>
              </View>
            }
          />

          <TouchableOpacity
            style={styles.fab}
            onPress={() => {
              resetForm();
              setModalVisible(true);
            }}
          >
            <Plus size={24} color="#0F172A" />
          </TouchableOpacity>
        </>
      )}

      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit Expense' : 'Record Expense'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.chipRow}>
                  {CATEGORIES.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, category === c && styles.chipActive]}
                      onPress={() => setCategory(c)}
                    >
                      <Text style={[styles.chipText, category === c && styles.chipTextActive]}>
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Plumbing repairs - Unit 4B"
                  placeholderTextColor="#999"
                  value={description}
                  onChangeText={setDescription}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Amount (KES)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 5000"
                  placeholderTextColor="#999"
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Date Incurred</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="YYYY-MM-DD (defaults to today)"
                  placeholderTextColor="#999"
                  value={incurredOn}
                  onChangeText={setIncurredOn}
                />
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>{editingId ? 'Save Changes' : 'Add Expense'}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  listContainer: { padding: 16, flexGrow: 1 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  summaryBox: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 4,
  },
  summaryLabel: { color: '#94A3B8', fontSize: 12, marginTop: 6 },
  summaryVal: { fontSize: 16, fontWeight: 'bold', marginTop: 2 },
  netBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    marginBottom: 20,
  },
  netVal: { fontSize: 22, fontWeight: 'bold', marginTop: 2 },
  listTitle: { fontSize: 16, fontWeight: 'bold', color: '#F8FAFC', marginBottom: 10, marginLeft: 4 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderColor: '#334155',
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardInfo: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: 'bold', color: '#F8FAFC' },
  subText: { color: '#94A3B8', fontSize: 12, marginTop: 4 },
  amount: { color: '#EF4444', fontSize: 16, fontWeight: 'bold', marginTop: 6 },
  actionGrid: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.05)',
  },
  deleteBtn: { borderColor: 'rgba(239, 68, 68, 0.4)', backgroundColor: 'rgba(239, 68, 68, 0.05)' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCentered: { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 20 },
  emptyText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.8)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 14,
    marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC' },
  modalBody: { paddingBottom: 20 },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#94A3B8', marginBottom: 6 },
  modalInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 15,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { borderColor: '#38BDF8', backgroundColor: 'rgba(56, 189, 248, 0.1)' },
  chipText: { color: '#94A3B8', fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
