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
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { Plus, X, DoorOpen, DoorClosed, Edit2, Trash2, User as UserIcon } from 'lucide-react-native';

interface UnitRow {
  id: string;
  property_id: string;
  unit_number: string;
  rent_amount: number;
  status: 'occupied' | 'vacant';
  tenant_id: string | null;
  profiles: { full_name: string } | null;
  properties: { title: string } | null;
}

export default function LandlordUnits() {
  const { propertyId, propertyTitle } = useLocalSearchParams<{ propertyId?: string; propertyTitle?: string }>();
  const { user } = useUser();
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalVisible, setModalVisible] = useState(false);
  const [unitNumber, setUnitNumber] = useState('');
  const [rentAmount, setRentAmount] = useState('');
  const [status, setStatus] = useState<'occupied' | 'vacant'>('vacant');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setUnitNumber('');
    setRentAmount('');
    setStatus('vacant');
  };

  const fetchUnits = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      let query = supabase
        .from('units')
        .select('id, property_id, unit_number, rent_amount, status, tenant_id, profiles:tenant_id ( full_name ), properties!inner ( title, owner_id )')
        .eq('properties.owner_id', user.id)
        .order('unit_number', { ascending: true });

      if (propertyId) query = query.eq('property_id', propertyId);

      const { data, error } = await query;
      if (error) throw error;
      setUnits((data as any) || []);
    } catch (err) {
      console.error('Fetch units error:', err);
      Alert.alert('Error', 'Failed to load units.');
    } finally {
      setLoading(false);
    }
  }, [propertyId, user?.id]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  useFocusEffect(
    useCallback(() => {
      fetchUnits();
    }, [fetchUnits])
  );

  const handleEdit = (unit: UnitRow) => {
    setEditingId(unit.id);
    setUnitNumber(unit.unit_number);
    setRentAmount(unit.rent_amount.toString());
    setStatus(unit.status);
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete Unit', 'Remove this unit? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('units').delete().eq('id', id);
            if (error) throw error;
            logAudit({
              actorId: user?.id || '',
              action: 'delete',
              entityType: 'unit',
              entityId: id,
              description: 'Deleted unit',
            });
            setUnits((prev) => prev.filter((u) => u.id !== id));
          } catch (err) {
            console.error('Delete unit error:', err);
            Alert.alert('Error', 'Failed to delete unit.');
          }
        },
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!unitNumber.trim()) {
      Alert.alert('Validation Error', 'Please enter a unit number.');
      return;
    }
    const rent = parseFloat(rentAmount || '0');
    if (isNaN(rent) || rent < 0) {
      Alert.alert('Validation Error', 'Please enter a valid rent amount.');
      return;
    }
    if (!editingId && !propertyId) {
      Alert.alert('Error', 'Open units from a specific property to add a new one.');
      return;
    }
    if (!user?.id) {
      Alert.alert('Error', 'Could not determine your account.');
      return;
    }

    if (status === 'occupied') {
      const previous = editingId ? units.find((u) => u.id === editingId)?.status : 'vacant';
      if (previous !== 'occupied') {
        Alert.alert(
          'Occupancy Note',
          'Marking a unit occupied manually can be overwritten by active leases. Prefer assigning a lease so occupancy stays in sync.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue', onPress: () => void saveUnit(rent) },
          ]
        );
        return;
      }
    }

    await saveUnit(rent);
  };

  const saveUnit = async (rent: number) => {
    if (!user?.id) return;
    try {
      setSubmitting(true);
      if (editingId) {
        const { error } = await supabase
          .from('units')
          .update({ unit_number: unitNumber.trim(), rent_amount: rent, status })
          .eq('id', editingId);
        if (error) throw error;
        logAudit({ actorId: user.id, action: 'update', entityType: 'unit', entityId: editingId, description: `Updated unit ${unitNumber.trim()}` });
      } else {
        const { error } = await supabase.from('units').insert({
          property_id: propertyId,
          owner_id: user.id,
          unit_number: unitNumber.trim(),
          rent_amount: rent,
          status,
        });
        if (error) throw error;
        logAudit({ actorId: user.id, action: 'create', entityType: 'unit', description: `Added unit ${unitNumber.trim()}` });
      }
      setModalVisible(false);
      resetForm();
      fetchUnits();
    } catch (err) {
      console.error('Save unit error:', err);
      Alert.alert('Error', 'Failed to save unit.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatPrice = (p: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(p);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          <FlatList
            data={units}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={
              propertyTitle ? (
                <Text style={styles.headerText}>Units for {propertyTitle}</Text>
              ) : (
                <Text style={styles.headerText}>All Units</Text>
              )
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.unitTitleRow}>
                    {item.status === 'occupied' ? (
                      <DoorClosed size={18} color="#10B981" style={styles.icon} />
                    ) : (
                      <DoorOpen size={18} color="#EAB308" style={styles.icon} />
                    )}
                    <Text style={styles.unitNumber}>Unit {item.unit_number}</Text>
                  </View>
                  <View style={[styles.badge, item.status === 'occupied' ? styles.badgeOccupied : styles.badgeVacant]}>
                    <Text style={styles.badgeText}>{item.status.toUpperCase()}</Text>
                  </View>
                </View>

                {!propertyId && item.properties?.title ? (
                  <Text style={styles.propText}>{item.properties.title}</Text>
                ) : null}

                <Text style={styles.rent}>{formatPrice(item.rent_amount)}/month</Text>

                <View style={styles.tenantRow}>
                  <UserIcon size={14} color="#94A3B8" style={styles.icon} />
                  <Text style={styles.tenantText}>
                    {item.profiles?.full_name ? item.profiles.full_name : 'No tenant assigned'}
                  </Text>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleEdit(item)}>
                    <Edit2 size={14} color="#38BDF8" style={styles.actionIcon} />
                    <Text style={styles.actionBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(item.id)}>
                    <Trash2 size={14} color="#EF4444" style={styles.actionIcon} />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            contentContainerStyle={styles.listContainer}
            onRefresh={fetchUnits}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <DoorOpen size={48} color="#94A3B8" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>No units created yet.</Text>
              </View>
            }
          />

          {propertyId ? (
            <TouchableOpacity
              style={styles.fab}
              onPress={() => {
                resetForm();
                setModalVisible(true);
              }}
            >
              <Plus size={24} color="#0F172A" />
            </TouchableOpacity>
          ) : null}
        </>
      )}

      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit Unit' : 'Add Unit'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Unit Number</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. A1"
                  placeholderTextColor="#999"
                  value={unitNumber}
                  onChangeText={setUnitNumber}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Rent Charge (KES/month)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 15000"
                  placeholderTextColor="#999"
                  value={rentAmount}
                  onChangeText={setRentAmount}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Status</Text>
                <View style={styles.toggleContainer}>
                  {(['vacant', 'occupied'] as const).map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.toggleBtn, status === s && styles.toggleBtnActive]}
                      onPress={() => setStatus(s)}
                    >
                      <Text style={[styles.toggleBtnText, status === s && styles.toggleBtnTextActive]}>{s.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>{editingId ? 'Save Changes' : 'Add Unit'}</Text>
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
  headerText: { fontSize: 16, fontWeight: 'bold', color: '#F8FAFC', marginBottom: 12 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  unitTitleRow: { flexDirection: 'row', alignItems: 'center' },
  unitNumber: { fontSize: 16, fontWeight: 'bold', color: '#F8FAFC' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeOccupied: { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: '#10B981' },
  badgeVacant: { backgroundColor: 'rgba(234, 179, 8, 0.15)', borderColor: '#EAB308' },
  badgeText: { fontSize: 10, fontWeight: 'bold', color: '#F8FAFC' },
  propText: { color: '#94A3B8', fontSize: 13, marginBottom: 4 },
  rent: { fontSize: 16, fontWeight: 'bold', color: '#38BDF8', marginVertical: 8 },
  tenantRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  tenantText: { color: '#94A3B8', fontSize: 13 },
  icon: { marginRight: 8 },
  actionRow: {
    flexDirection: 'row',
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
    marginRight: 6,
  },
  deleteBtn: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    marginRight: 0,
    marginLeft: 6,
  },
  actionIcon: { marginRight: 6 },
  actionBtnText: { color: '#38BDF8', fontWeight: '600', fontSize: 13 },
  deleteBtnText: { color: '#EF4444', fontWeight: '600', fontSize: 13 },
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCentered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, marginTop: 60 },
  emptyIcon: { marginBottom: 12 },
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
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  toggleBtnActive: { backgroundColor: '#38BDF8' },
  toggleBtnText: { color: '#94A3B8', fontWeight: '600', fontSize: 12 },
  toggleBtnTextActive: { color: '#0F172A', fontWeight: 'bold' },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
