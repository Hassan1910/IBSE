import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { getLowStockThreshold } from '../../lib/settings';
import { Plus, Minus, X, Package, Edit2, Trash2, History } from 'lucide-react-native';

interface InventoryItem {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
}

interface UsageRecord {
  id: string;
  quantity_used: number;
  notes: string | null;
  created_at: string;
  maintenance_requests: { title: string } | null;
  profiles: { full_name: string } | null;
}

export default function AdminInventoryScreen() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Item Modal States
  const [modalVisible, setModalVisible] = useState(false);
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Usage history modal state
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [usages, setUsages] = useState<UsageRecord[]>([]);
  const [loadingUsages, setLoadingUsages] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setItemName('');
    setQuantity('');
    setUnit('pcs');
  };

  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setItemName(item.item_name);
    setQuantity(item.quantity.toString());
    setUnit(item.unit);
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete Item', 'Are you sure you want to delete this inventory item?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive', 
        onPress: async () => {
          try {
            const { error } = await supabase.from('inventory').delete().eq('id', id);
            if (error) throw error;
            Alert.alert('Success', 'Item deleted.');
            setInventory(prev => prev.filter(i => i.id !== id));
          } catch (err) {
            console.error('Delete item error:', err);
            Alert.alert('Error', 'Failed to delete item.');
          }
        }
      }
    ]);
  };

  const openHistory = async (item: InventoryItem) => {
    setHistoryItem(item);
    try {
      setLoadingUsages(true);
      const { data, error } = await supabase
        .from('inventory_usages')
        .select('id, quantity_used, notes, created_at, maintenance_requests ( title ), profiles:used_by ( full_name )')
        .eq('inventory_id', item.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setUsages((data as any) || []);
    } catch (err) {
      console.error('Fetch usage history error:', err);
      Alert.alert('Error', 'Failed to load usage history.');
    } finally {
      setLoadingUsages(false);
    }
  };

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .order('item_name', { ascending: true });

      if (error) throw error;
      setInventory(data || []);
    } catch (err: any) {
      console.error('Fetch inventory error:', err);
      Alert.alert('Error', 'Failed to retrieve inventory items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const stockStatusForQty = async (qty: number) => {
    const threshold = await getLowStockThreshold();
    if (qty === 0) return 'out_of_stock' as const;
    if (qty <= threshold) return 'low_stock' as const;
    return 'in_stock' as const;
  };

  const handleUpdateQuantity = async (id: string, currentQty: number, change: number) => {
    const nextQty = Math.max(0, currentQty + change);
    const nextStatus = await stockStatusForQty(nextQty);

    try {
      const { error } = await supabase
        .from('inventory')
        .update({ quantity: nextQty, status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      // Update state locally
      setInventory((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, quantity: nextQty, status: nextStatus } : item
        )
      );
    } catch (err: any) {
      console.error('Update quantity error:', err);
      Alert.alert('Error', 'Failed to update stock quantity.');
    }
  };

  const handleSubmit = async () => {
    if (!itemName.trim() || !quantity) {
      Alert.alert('Validation Error', 'Please fill in item name and quantity.');
      return;
    }

    const numQty = parseInt(quantity);
    if (isNaN(numQty) || numQty < 0) {
      Alert.alert('Validation Error', 'Please enter a valid non-negative quantity.');
      return;
    }

    const nextStatus = await stockStatusForQty(numQty);

    try {
      setSubmitting(true);
      
      if (editingId) {
        const { error } = await supabase.from('inventory')
          .update({
            item_name: itemName.trim(),
            quantity: numQty,
            unit: unit.trim() || 'pcs',
            status: nextStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingId);

        if (error) throw error;
        Alert.alert('Success 🎉', 'Inventory item updated.');
      } else {
        const { error } = await supabase.from('inventory').insert({
          item_name: itemName.trim(),
          quantity: numQty,
          unit: unit.trim() || 'pcs',
          status: nextStatus,
        });

        if (error) throw error;
        Alert.alert('Success 🎉', 'Inventory item added.');
      }

      setModalVisible(false);
      resetForm();
      fetchInventory();
    } catch (err: any) {
      console.error('Save inventory item error:', err);
      Alert.alert('Error', 'Failed to save inventory item.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusColor = (status: string) => {
    if (status === 'in_stock') return '#10B981';
    if (status === 'low_stock') return '#EAB308';
    return '#EF4444';
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          <FlatList
            data={inventory}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardInfo}>
                  <Text style={styles.itemName}>{item.item_name}</Text>
                  <Text style={styles.subText}>
                    Stock: {item.quantity} {item.unit}
                  </Text>
                  <View style={[
                    styles.statusLabel,
                    { backgroundColor: `${getStatusColor(item.status)}15` }
                  ]}>
                    <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
                      {item.status.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                </View>

                <View style={styles.actionGrid}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => openHistory(item)}>
                    <History size={16} color="#38BDF8" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleEdit(item)}>
                    <Edit2 size={16} color="#38BDF8" />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(item.id)}>
                    <Trash2 size={16} color="#EF4444" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.countBtn, styles.minusBtn]}
                    onPress={() => handleUpdateQuantity(item.id, item.quantity, -1)}
                  >
                    <Minus size={16} color="#EF4444" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.countBtn, styles.plusBtn]}
                    onPress={() => handleUpdateQuantity(item.id, item.quantity, 1)}
                  >
                    <Plus size={16} color="#10B981" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
            contentContainerStyle={styles.listContainer}
            onRefresh={fetchInventory}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <Package size={48} color="#94A3B8" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>No inventory items tracked yet.</Text>
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

      {/* Add Item Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit Inventory Item' : 'Track New Inventory Item'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Item Name</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Paint Brushes, LED bulbs"
                  placeholderTextColor="#999"
                  value={itemName}
                  onChangeText={setItemName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Initial Quantity</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 15"
                  placeholderTextColor="#999"
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Unit</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. pcs, rolls, tins"
                  placeholderTextColor="#999"
                  value={unit}
                  onChangeText={setUnit}
                />
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>{editingId ? 'Save Changes' : 'Add to Inventory'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Usage History Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={!!historyItem}
        onRequestClose={() => setHistoryItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.historyModal]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Usage History — {historyItem?.item_name}</Text>
              <TouchableOpacity onPress={() => setHistoryItem(null)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {loadingUsages ? (
              <ActivityIndicator size="large" color="#38BDF8" style={styles.historyLoading} />
            ) : usages.length === 0 ? (
              <View style={styles.historyEmpty}>
                <Package size={32} color="#94A3B8" />
                <Text style={styles.emptyText}>No recorded usage for this item yet.</Text>
              </View>
            ) : (
              <FlatList
                data={usages}
                keyExtractor={(u) => u.id}
                renderItem={({ item: usage }) => (
                  <View style={styles.usageRow}>
                    <View style={styles.usageInfo}>
                      <Text style={styles.usageQty}>
                        -{usage.quantity_used} {historyItem?.unit}
                      </Text>
                      <Text style={styles.usageMeta}>
                        {usage.maintenance_requests?.title
                          ? `Maintenance: ${usage.maintenance_requests.title}`
                          : 'General usage'}
                      </Text>
                      <Text style={styles.usageMeta}>
                        By {usage.profiles?.full_name || 'Unknown'} on{' '}
                        {new Date(usage.created_at).toLocaleDateString('en-KE', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                      {usage.notes ? <Text style={styles.usageNotes}>"{usage.notes}"</Text> : null}
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  listContainer: {
    padding: 16,
    flexGrow: 1,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  subText: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 4,
  },
  statusLabel: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  actionGrid: {
    flexDirection: 'row',
    alignItems: 'center',
  },
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
  deleteBtn: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  countBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
  },
  minusBtn: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  plusBtn: {
    borderColor: 'rgba(16, 185, 129, 0.4)',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
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
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCentered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    marginTop: 60,
  },
  emptyIcon: {
    marginBottom: 12,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
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
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  modalBody: {
    paddingBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
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
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  submitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
  historyModal: {
    maxHeight: '75%',
  },
  historyLoading: {
    marginVertical: 30,
  },
  historyEmpty: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 10,
  },
  usageRow: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  usageInfo: {
    flex: 1,
  },
  usageQty: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  usageMeta: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 2,
  },
  usageNotes: {
    color: '#94A3B8',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
