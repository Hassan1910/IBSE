import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { Package, X, Check } from 'lucide-react-native';

interface InventoryItem {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
}

interface MaterialsUsedModalProps {
  visible: boolean;
  onClose: () => void;
  maintenanceRequestId: string;
  maintenanceTitle: string;
  userId: string;
  onRecorded?: () => void;
}

/**
 * Lets staff (admin) or landlords record inventory materials consumed on a
 * maintenance request. Stock is decremented automatically by a database
 * trigger on the inventory_usages table.
 */
export default function MaterialsUsedModal({
  visible,
  onClose,
  maintenanceRequestId,
  maintenanceTitle,
  userId,
  onRecorded,
}: MaterialsUsedModalProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantityUsed, setQuantityUsed] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      setLoadingItems(true);
      const { data, error } = await supabase
        .from('inventory')
        .select('id, item_name, quantity, unit, status')
        .gt('quantity', 0)
        .order('item_name', { ascending: true });
      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      console.error('Fetch inventory error:', err);
      Alert.alert('Error', 'Failed to load inventory items.');
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setSelectedId(null);
      setQuantityUsed('');
      setNotes('');
      fetchItems();
    }
  }, [visible, fetchItems]);

  const selectedItem = items.find((i) => i.id === selectedId) || null;

  const handleSave = async () => {
    if (!selectedItem) {
      Alert.alert('Validation Error', 'Select an inventory item.');
      return;
    }
    const qty = parseInt(quantityUsed, 10);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Validation Error', 'Enter a valid quantity greater than zero.');
      return;
    }
    if (qty > selectedItem.quantity) {
      Alert.alert(
        'Insufficient Stock',
        `Only ${selectedItem.quantity} ${selectedItem.unit} of "${selectedItem.item_name}" in stock.`
      );
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase.from('inventory_usages').insert({
        inventory_id: selectedItem.id,
        maintenance_request_id: maintenanceRequestId,
        quantity_used: qty,
        used_by: userId,
        notes: notes.trim() || null,
      });
      if (error) throw error;

      logAudit({
        actorId: userId,
        action: 'create',
        entityType: 'inventory_usage',
        entityId: maintenanceRequestId,
        description: `Used ${qty} ${selectedItem.unit} of ${selectedItem.item_name} on maintenance "${maintenanceTitle}"`,
      });

      Alert.alert('Success', 'Materials usage recorded and stock updated.');
      onRecorded?.();
      onClose();
    } catch (err) {
      console.error('Record materials error:', err);
      Alert.alert('Error', 'Failed to record materials usage.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Record Materials Used</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={24} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>{maintenanceTitle}</Text>

          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>Inventory Item</Text>
            {loadingItems ? (
              <ActivityIndicator color="#38BDF8" style={styles.itemsLoading} />
            ) : items.length === 0 ? (
              <View style={styles.emptyBox}>
                <Package size={20} color="#94A3B8" />
                <Text style={styles.emptyText}>No inventory items in stock.</Text>
              </View>
            ) : (
              <View style={styles.itemList}>
                {items.map((item) => {
                  const active = item.id === selectedId;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.itemRow, active && styles.itemRowActive]}
                      onPress={() => setSelectedId(item.id)}
                    >
                      <View style={styles.itemInfo}>
                        <Text style={[styles.itemName, active && styles.itemNameActive]}>
                          {item.item_name}
                        </Text>
                        <Text style={styles.itemStock}>
                          {item.quantity} {item.unit} in stock
                        </Text>
                      </View>
                      {active && <Check size={18} color="#38BDF8" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Quantity Used{selectedItem ? ` (${selectedItem.unit})` : ''}
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 2"
                placeholderTextColor="#999"
                value={quantityUsed}
                onChangeText={setQuantityUsed}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Replaced kitchen tap washer"
                placeholderTextColor="#999"
                value={notes}
                onChangeText={setNotes}
              />
            </View>

            <TouchableOpacity style={styles.submitBtn} onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text style={styles.submitBtnText}>Record Usage</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 14,
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  modalSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 14,
  },
  modalBody: {
    paddingBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
  itemsLoading: {
    marginVertical: 16,
  },
  emptyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    marginLeft: 8,
  },
  itemList: {
    marginBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  itemRowActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  itemInfo: {
    flex: 1,
    marginRight: 8,
  },
  itemName: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  itemNameActive: {
    color: '#38BDF8',
  },
  itemStock: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  inputGroup: {
    marginBottom: 16,
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
    marginTop: 6,
  },
  submitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
