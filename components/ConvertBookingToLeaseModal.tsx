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
  createPendingLeaseFromBooking,
  fetchAssignableUnits,
  leaseAssignErrorMessage,
  type AssignableUnit,
} from '../lib/leases';
import {
  depositAmountFromRent,
  fetchVerifiedDepositForClientProperty,
  type DepositPayment,
} from '../lib/depositPayments';
import { notifyUser } from '../lib/notifications';
import DatePickerModal from './DatePickerModal';
import { adminTheme } from '../constants/adminTheme';

/** Booking or deposit-driven context for creating a pending lease. */
export type LeaseConversionSource = {
  /** When set, that booking is marked completed after lease create. */
  bookingId?: string | null;
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

type LandlordOption = {
  id: string;
  full_name: string;
  email: string;
};

type Props = {
  visible: boolean;
  /** @deprecated Prefer `source`. Kept for booking callers that still pass `booking`. */
  booking?: LeaseConversionSource | null;
  source?: LeaseConversionSource | null;
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

export default function ConvertBookingToLeaseModal({
  visible,
  booking,
  source,
  onClose,
  onCreated,
}: Props) {
  const leaseSource = source ?? booking ?? null;

  const [units, setUnits] = useState<AssignableUnit[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rent, setRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [verifiedDeposit, setVerifiedDeposit] = useState<DepositPayment | null>(null);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  const [endPickerOpen, setEndPickerOpen] = useState(false);
  const [landlords, setLandlords] = useState<LandlordOption[]>([]);
  const [selectedLandlordId, setSelectedLandlordId] = useState<string | null>(null);
  const [propertyTitle, setPropertyTitle] = useState('');
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [initialOwnerId, setInitialOwnerId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !leaseSource) return;

    const propertyId = leaseSource.property_id;
    const clientId = leaseSource.client_id;
    const listPrice = leaseSource.properties?.price;

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const start = `${y}-${m}-${d}`;
    setStartDate(start);
    setEndDate(addMonths(start, 12));
    setRent(listPrice ? String(listPrice) : '');
    setDeposit('');
    setVerifiedDeposit(null);
    setSelectedUnit(null);
    setLandlords([]);
    setSelectedLandlordId(leaseSource.properties?.owner_id || null);
    setInitialOwnerId(leaseSource.properties?.owner_id || null);
    setPropertyTitle(leaseSource.properties?.title || '');
    setPropertyType(leaseSource.properties?.type || null);

    let cancelled = false;
    (async () => {
      try {
        setLoadingUnits(true);
        const [list, paidDeposit, propertyRes, landlordsRes] = await Promise.all([
          fetchAssignableUnits(propertyId),
          fetchVerifiedDepositForClientProperty(clientId, propertyId),
          supabase
            .from('properties')
            .select('title, type, owner_id, price')
            .eq('id', propertyId)
            .maybeSingle(),
          supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('role', 'landlord')
            .order('full_name', { ascending: true }),
        ]);
        if (cancelled) return;

        if (propertyRes.error) throw propertyRes.error;
        if (landlordsRes.error) throw landlordsRes.error;

        const property = propertyRes.data;
        if (property) {
          setPropertyTitle(property.title || leaseSource.properties?.title || '');
          setPropertyType(property.type || leaseSource.properties?.type || null);
          setInitialOwnerId(property.owner_id || null);
          setSelectedLandlordId(property.owner_id || null);
          if (property.price && !listPrice) {
            setRent(String(property.price));
          }
        }

        setLandlords((landlordsRes.data as LandlordOption[]) || []);

        setUnits(list);
        if (list.length === 1) {
          setSelectedUnit(list[0].id);
          if (list[0].rent_amount) setRent(String(list[0].rent_amount));
        }
        if (paidDeposit) {
          setVerifiedDeposit(paidDeposit);
          setDeposit(String(paidDeposit.amount));
        } else {
          const priceForDeposit = property?.price ?? listPrice;
          if (priceForDeposit) {
            setDeposit(String(depositAmountFromRent(Number(priceForDeposit))));
          }
        }
      } catch (err) {
        console.error('Load units for convert lease:', err);
        if (!cancelled) setUnits([]);
      } finally {
        if (!cancelled) setLoadingUnits(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, leaseSource?.client_id, leaseSource?.property_id, leaseSource?.properties?.price]);

  const handleCreate = async () => {
    if (!leaseSource) return;
    if (propertyType === 'sale' || leaseSource.properties?.type === 'sale') {
      Alert.alert(
        'Sale Property',
        'Sale listings cannot be converted to a rental lease. Ask the buyer to submit purchase proof in-app, or mark the property sold from Properties.'
      );
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
    if (!selectedLandlordId) {
      Alert.alert(
        'Landlord Required',
        landlords.length === 0
          ? 'No landlords available. Invite or create a landlord account first.'
          : 'Select a landlord for this property before creating the lease.'
      );
      return;
    }

    const depositAlreadyHeld = !!verifiedDeposit && depositAmount > 0;
    const title = propertyTitle || leaseSource.properties?.title || 'the property';

    try {
      setSubmitting(true);

      const leaseId = await createPendingLeaseFromBooking({
        clientId: leaseSource.client_id,
        propertyId: leaseSource.property_id,
        ownerId: selectedLandlordId,
        unitId: selectedUnit,
        startDate,
        endDate,
        rentAmount,
        depositAmount,
        bookingId: leaseSource.bookingId,
        depositId: verifiedDeposit?.id ?? null,
      });

      if (selectedLandlordId !== initialOwnerId) {
        setInitialOwnerId(selectedLandlordId);
      }

      try {
        await notifyUser({
          userId: leaseSource.client_id,
          type: 'booking_update',
          title: 'Lease Created',
          body: depositAlreadyHeld
            ? `A pending lease was created for ${title}. Your security deposit is already held. Submit rent payment (full amount) to activate.`
            : `A pending lease was created for ${title}. Submit your first rent payment to activate it.`,
          entityType: 'lease',
          entityId: leaseId,
        });
      } catch (notifyErr) {
        console.warn('Lease created but notify failed:', notifyErr);
      }

      Alert.alert(
        'Lease Created',
        depositAlreadyHeld
          ? 'Pending lease created with deposit already held. It activates after the first verified rent payment.'
          : 'Pending lease created and client promoted to tenant. It activates after the first verified payment.',
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
              <Text style={styles.title}>
                {leaseSource?.bookingId ? 'Convert to Lease' : 'Create Lease'}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <X size={22} color={adminTheme.colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.meta}>
                {leaseSource?.profiles?.full_name || 'Client'} ·{' '}
                {propertyTitle || leaseSource?.properties?.title || 'Property'}
              </Text>

              {verifiedDeposit ? (
                <Text style={styles.depositNote}>
                  Verified booking deposit will be recorded as held (not charged again). Tenant still
                  pays full rent when occupying.
                </Text>
              ) : null}

              {loadingUnits ? (
                <ActivityIndicator color={adminTheme.colors.accent} style={{ marginVertical: 16 }} />
              ) : (
                <>
                  <View style={styles.group}>
                    <Text style={styles.label}>Landlord (required)</Text>
                    {landlords.length === 0 ? (
                      <Text style={styles.warnHint}>
                        No landlords available. Invite or create a landlord account first.
                      </Text>
                    ) : (
                      landlords.map((l) => (
                        <TouchableOpacity
                          key={l.id}
                          style={[styles.chip, selectedLandlordId === l.id && styles.chipActive]}
                          onPress={() => setSelectedLandlordId(l.id)}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              selectedLandlordId === l.id && styles.chipTextActive,
                            ]}
                          >
                            {l.full_name} ({l.email})
                          </Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>

                  {units.length > 0 ? (
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
                          <Text
                            style={[styles.chipText, selectedUnit === u.id && styles.chipTextActive]}
                          >
                            {u.unit_number} · KES {Number(u.rent_amount).toLocaleString()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.hint}>Whole-property lease (no vacant units listed).</Text>
                  )}
                </>
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
                <Text style={styles.label}>
                  Security deposit (KES){verifiedDeposit ? ' — already paid' : ', optional'}
                </Text>
                <TextInput
                  style={[styles.input, verifiedDeposit ? styles.inputLocked : null]}
                  value={deposit}
                  onChangeText={setDeposit}
                  keyboardType="numeric"
                  editable={!verifiedDeposit}
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
  depositNote: {
    color: adminTheme.colors.accent,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    backgroundColor: adminTheme.colors.accentMuted,
    padding: 10,
    borderRadius: 8,
  },
  group: { marginBottom: 14 },
  label: { color: adminTheme.colors.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  hint: { color: adminTheme.colors.textMuted, fontSize: 13, marginBottom: 12 },
  warnHint: { color: '#EAB308', fontSize: 12, lineHeight: 17 },
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
  inputLocked: {
    opacity: 0.9,
    color: adminTheme.colors.accent,
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
