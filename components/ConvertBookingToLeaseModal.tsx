import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { X } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import {
  fetchAssignableUnits,
  hasOverlappingLease,
  leaseAssignErrorMessage,
  promoteClientToTenant,
  type AssignableUnit,
} from '../lib/leases';
import { notifyUser } from '../lib/notifications';
import DatePickerModal from './DatePickerModal';
import { adminTheme } from '../constants/adminTheme';

type BookingForLease = {
  id: string;
  client_id: string;
  property_id: string;
  properties?: {
    title?: string;
    type?: string;
    owner_id?: string | null;
    price?: number;
  } | null;
  profiles?: {
    full_name?: string;
    email?: string;
  } | null;
};

type Props = {
  visible: boolean;
  booking: BookingForLease | null;
  onClose: () => void;
  onCreated: () => void;
};

function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export default function ConvertBookingToLeaseModal({ visible, booking, onClose, onCreated }: Props) {
  const [units, setUnits] = useState<AssignableUnit[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rent, setRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  const [endPickerOpen, setEndPickerOpen] = useState(false);

  useEffect(() => {
    if (!visible || !booking) return;

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const start = `${y}-${m}-${d}`;
    setStartDate(start);
    setEndDate(addMonths(start, 12));
    setRent(booking.properties?.price ? String(booking.properties.price) : '');
    setDeposit('');
    setSelectedUnit(null);

    (async () => {
      try {
        setLoadingUnits(true);
        const list = await fetchAssignableUnits(booking.property_id);
        setUnits(list);
        if (list.length === 1) {
          setSelectedUnit(list[0].id);
          if (list[0].rent_amount) setRent(String(list[0].rent_amount));
        }
      } catch (err) {
        console.error('Load units for convert lease:', err);
        setUnits([]);
      } finally {
        setLoadingUnits(false);
      }
    })();
  }, [visible, booking]);

  const handleCreate = async () => {
    if (!booking) return;
    if (booking.properties?.type === 'sale') {
      Alert.alert('Sale Property', 'Sale listings cannot be converted to a rental lease. Mark the property sold instead.');
      return;
    }
    if (!startDate || !endDate) {
      Alert.alert('Validation Error', 'Please choose lease start and end dates.');
      return;
    }
    if (endDate < startDate) {
      Alert.alert('Validation Error', 'End date must be on or after the start date.');
      return;
    }
    const rentAmount = parseFloat(rent);
    if (!rent || isNaN(rentAmount) || rentAmount <= 0) {
      Alert.alert('Validation Error', 'Enter a valid monthly rent amount.');
      return;
    }
    const depositAmount = deposit.trim() ? parseFloat(deposit) : 0;
    if (isNaN(depositAmount) || depositAmount < 0) {
      Alert.alert('Validation Error', 'Enter a valid deposit amount (or leave blank).');
      return;
    }
    if (units.length > 0 && !selectedUnit) {
      Alert.alert('Validation Error', 'Select a vacant unit for this property.');
      return;
    }
    if (!booking.properties?.owner_id) {
      Alert.alert(
        'Landlord Required',
        'Assign a landlord to this property before creating a lease.',
      );
      return;
    }

    try {
      setSubmitting(true);
      const overlaps = await hasOverlappingLease({
        propertyId: booking.property_id,
        unitId: selectedUnit,
        startDate,
        endDate,
      });
      if (overlaps) {
        Alert.alert(
          'Space Unavailable',
          'This space already has a pending or active lease for overlapping dates.',
        );
        return;
      }

      const { data: lease, error } = await supabase
        .from('leases')
        .insert({
          property_id: booking.property_id,
          unit_id: selectedUnit || null,
          tenant_id: booking.client_id,
          owner_id: booking.properties.owner_id,
          start_date: startDate,
          end_date: endDate,
          rent_amount: rentAmount,
          deposit_amount: depositAmount,
          deposit_status: depositAmount > 0 ? 'due' : 'none',
          status: 'pending',
        })
        .select('id')
        .single();
      if (error) throw error;

      await promoteClientToTenant(booking.client_id);

      await supabase.from('bookings').update({ status: 'completed' }).eq('id', booking.id);

      await notifyUser({
        userId: booking.client_id,
        type: 'booking_update',
        title: 'Lease Created',
        body: `A pending lease was created for ${booking.properties?.title || 'the property'}. Submit your first rent payment to activate it.`,
        entityType: 'lease',
        entityId: lease?.id,
      });

      Alert.alert(
        'Lease Created',
        'Pending lease created and client promoted to tenant. It activates after the first verified payment.',
      );
      onCreated();
      onClose();
    } catch (err) {
      console.error('Convert booking to lease error:', err);
      Alert.alert('Error', leaseAssignErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Convert to Lease</Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={22} color={adminTheme.colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.meta}>
                {booking?.profiles?.full_name || 'Client'} · {booking?.properties?.title || 'Property'}
              </Text>

              {loadingUnits ? (
                <ActivityIndicator color={adminTheme.colors.accent} style={{ marginVertical: 16 }} />
              ) : units.length > 0 ? (
                <View style={styles.group}>
                  <Text style={styles.label}>Unit</Text>
                  {units.map((u) => (
                    <TouchableOpacity
                      key={u.id}
                      style={[styles.chip, selectedUnit === u.id && styles.chipActive]}
                      onPress={() => {
                        setSelectedUnit(u.id);
                        if (u.rent_amount) setRent(String(u.rent_amount));
                      }}
                    >
                      <Text style={[styles.chipText, selectedUnit === u.id && styles.chipTextActive]}>
                        {u.unit_number} · KES {Number(u.rent_amount).toLocaleString()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={styles.hint}>Whole-property lease (no vacant units listed).</Text>
              )}

              <View style={styles.group}>
                <Text style={styles.label}>Start date</Text>
                <TouchableOpacity style={styles.inputBtn} onPress={() => setStartPickerOpen(true)}>
                  <Text style={styles.inputBtnText}>{startDate || 'Select start date'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.group}>
                <Text style={styles.label}>End date</Text>
                <TouchableOpacity style={styles.inputBtn} onPress={() => setEndPickerOpen(true)}>
                  <Text style={styles.inputBtnText}>{endDate || 'Select end date'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.group}>
                <Text style={styles.label}>Monthly rent (KES)</Text>
                <TextInput
                  style={styles.input}
                  value={rent}
                  onChangeText={setRent}
                  keyboardType="numeric"
                  placeholder="e.g. 25000"
                  placeholderTextColor="#64748B"
                />
              </View>

              <View style={styles.group}>
                <Text style={styles.label}>Security deposit (KES, optional)</Text>
                <TextInput
                  style={styles.input}
                  value={deposit}
                  onChangeText={setDeposit}
                  keyboardType="numeric"
                  placeholder="e.g. 50000"
                  placeholderTextColor="#64748B"
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, submitting && { opacity: 0.7 }]}
                onPress={handleCreate}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color={adminTheme.colors.onAccent} />
                ) : (
                  <Text style={styles.primaryBtnText}>Create Pending Lease</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <DatePickerModal
        visible={startPickerOpen}
        onClose={() => setStartPickerOpen(false)}
        value={startDate}
        onChange={(d) => {
          setStartDate(d);
          if (!endDate || endDate < d) setEndDate(addMonths(d, 12));
          setStartPickerOpen(false);
        }}
        title="Lease start"
      />
      <DatePickerModal
        visible={endPickerOpen}
        onClose={() => setEndPickerOpen(false)}
        value={endDate}
        onChange={(d) => {
          setEndDate(d);
          setEndPickerOpen(false);
        }}
        title="Lease end"
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: adminTheme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: adminTheme.colors.text, fontSize: 18, fontWeight: '700' },
  meta: { color: adminTheme.colors.textMuted, marginBottom: 16, fontSize: 13 },
  group: { marginBottom: 14 },
  label: { color: adminTheme.colors.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  hint: { color: adminTheme.colors.textMuted, fontSize: 13, marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  chipActive: { borderColor: adminTheme.colors.accent, backgroundColor: adminTheme.colors.accentMuted },
  chipText: { color: adminTheme.colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: adminTheme.colors.accent },
  inputBtn: {
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
    borderRadius: 10,
    padding: 12,
    backgroundColor: adminTheme.colors.bg,
  },
  inputBtnText: { color: adminTheme.colors.text },
  input: {
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
    borderRadius: 10,
    padding: 12,
    color: adminTheme.colors.text,
    backgroundColor: adminTheme.colors.bg,
  },
  primaryBtn: {
    backgroundColor: adminTheme.colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  primaryBtnText: { color: adminTheme.colors.onAccent, fontWeight: '700', fontSize: 15 },
});
