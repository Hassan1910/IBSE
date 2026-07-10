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
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { Plus, X, FileText, Calendar, User as UserIcon, Home, RefreshCw, Ban, Link as LinkIcon } from 'lucide-react-native';

interface Lease {
  id: string;
  property_id: string;
  unit_id: string | null;
  tenant_id: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  status: 'active' | 'terminated' | 'expired';
  terms: string | null;
  contract_url: string | null;
  properties: { title: string } | null;
  profiles: { full_name: string } | null;
}

interface OptionProfile { id: string; full_name: string; role: string; }
interface OptionProperty { id: string; title: string; price: number; }
interface OptionUnit { id: string; unit_number: string; rent_amount: number; }

export default function LandlordAgreements() {
  const { user } = useUser();
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loading, setLoading] = useState(true);

  const [tenants, setTenants] = useState<OptionProfile[]>([]);
  const [properties, setProperties] = useState<OptionProperty[]>([]);
  const [units, setUnits] = useState<OptionUnit[]>([]);

  // Create modal
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [selectedProperty, setSelectedProperty] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rentAmount, setRentAmount] = useState('');
  const [terms, setTerms] = useState('');
  const [contractUrl, setContractUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Renew modal
  const [renewVisible, setRenewVisible] = useState(false);
  const [renewLease, setRenewLease] = useState<Lease | null>(null);
  const [renewEndDate, setRenewEndDate] = useState('');

  const fetchLeases = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('leases')
        .select('id, property_id, unit_id, tenant_id, start_date, end_date, rent_amount, status, terms, contract_url, properties ( title ), profiles:tenant_id ( full_name )')
        .eq('owner_id', user.id)
        .order('start_date', { ascending: false });
      if (error) throw error;
      setLeases((data as any) || []);
    } catch (err) {
      console.error('Fetch leases error:', err);
      Alert.alert('Error', 'Failed to load rental agreements.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const fetchOptions = useCallback(async () => {
    if (!user?.id) return;
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['tenant', 'client'])
      .order('full_name', { ascending: true });
    setTenants((profs as any) || []);

    const { data: props } = await supabase
      .from('properties')
      .select('id, title, price')
      .eq('type', 'rental')
      .eq('owner_id', user.id)
      .order('title', { ascending: true });
    setProperties((props as any) || []);
  }, [user?.id]);

  useEffect(() => {
    fetchLeases();
    fetchOptions();
  }, [fetchLeases, fetchOptions]);

  // Load units whenever the selected property changes.
  useEffect(() => {
    if (!selectedProperty) {
      setUnits([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('units')
        .select('id, unit_number, rent_amount')
        .eq('property_id', selectedProperty)
        .eq('status', 'vacant')
        .order('unit_number', { ascending: true });
      setUnits((data as any) || []);
    })();
  }, [selectedProperty]);

  const resetForm = () => {
    setSelectedTenant('');
    setSelectedProperty('');
    setSelectedUnit('');
    setStartDate('');
    setEndDate('');
    setRentAmount('');
    setTerms('');
    setContractUrl('');
  };

  const handleCreate = async () => {
    if (!selectedTenant || !selectedProperty || !startDate || !endDate || !rentAmount) {
      Alert.alert('Validation Error', 'Please select a tenant, property, dates and rent amount.');
      return;
    }
    const rent = parseFloat(rentAmount);
    if (isNaN(rent) || rent <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid rent amount.');
      return;
    }
    if (!user?.id) {
      Alert.alert('Error', 'Could not determine your account.');
      return;
    }

    try {
      setSubmitting(true);
      const { error: leaseError } = await supabase.from('leases').insert({
        property_id: selectedProperty,
        unit_id: selectedUnit || null,
        tenant_id: selectedTenant,
        owner_id: user.id,
        start_date: startDate,
        end_date: endDate,
        rent_amount: rent,
        terms: terms.trim() || null,
        contract_url: contractUrl.trim() || null,
        status: 'active',
      });
      if (leaseError) throw leaseError;

      // Mark the property as rented.
      await supabase.from('properties').update({ status: 'rented' }).eq('id', selectedProperty);

      // If a specific unit was chosen, mark it occupied and assign the tenant.
      if (selectedUnit) {
        await supabase
          .from('units')
          .update({ status: 'occupied', tenant_id: selectedTenant })
          .eq('id', selectedUnit);
      }

      logAudit({ actorId: user.id, action: 'create', entityType: 'lease', description: 'Created rental agreement' });
      Alert.alert('Success', 'Rental agreement created.');
      setModalVisible(false);
      resetForm();
      fetchLeases();
      fetchOptions();
    } catch (err) {
      console.error('Create lease error:', err);
      Alert.alert('Error', 'Failed to create rental agreement.');
    } finally {
      setSubmitting(false);
    }
  };

  const openRenew = (lease: Lease) => {
    setRenewLease(lease);
    setRenewEndDate(lease.end_date);
    setRenewVisible(true);
  };

  const handleRenew = async () => {
    if (!renewLease || !renewEndDate) {
      Alert.alert('Validation Error', 'Please enter a new end date.');
      return;
    }
    try {
      const { error } = await supabase
        .from('leases')
        .update({ end_date: renewEndDate, status: 'active' })
        .eq('id', renewLease.id);
      if (error) throw error;
      logAudit({ actorId: user?.id || '', action: 'update', entityType: 'lease', entityId: renewLease.id, description: 'Renewed rental agreement' });
      Alert.alert('Success', 'Agreement renewed.');
      setRenewVisible(false);
      setRenewLease(null);
      fetchLeases();
    } catch (err) {
      console.error('Renew lease error:', err);
      Alert.alert('Error', 'Failed to renew agreement.');
    }
  };

  const handleTerminate = (lease: Lease) => {
    Alert.alert('Terminate Agreement', 'Terminate this rental agreement? The unit and property will be freed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Terminate',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('leases').update({ status: 'terminated' }).eq('id', lease.id);
            if (error) throw error;
            await supabase.from('properties').update({ status: 'available' }).eq('id', lease.property_id);
            if (lease.unit_id) {
              await supabase.from('units').update({ status: 'vacant', tenant_id: null }).eq('id', lease.unit_id);
            }
            logAudit({ actorId: user?.id || '', action: 'update', entityType: 'lease', entityId: lease.id, description: 'Terminated rental agreement' });
            Alert.alert('Success', 'Agreement terminated.');
            fetchLeases();
          } catch (err) {
            console.error('Terminate lease error:', err);
            Alert.alert('Error', 'Failed to terminate agreement.');
          }
        },
      },
    ]);
  };

  const formatPrice = (p: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(p);
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });

  const statusColor = (s: string) => (s === 'active' ? '#10B981' : s === 'expired' ? '#EAB308' : '#EF4444');

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          <FlatList
            data={leases}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.properties?.title || 'Property'}</Text>
                  <View style={[styles.badge, { borderColor: statusColor(item.status) }]}>
                    <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <UserIcon size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>{item.profiles?.full_name || 'Tenant'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Calendar size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>{formatDate(item.start_date)} - {formatDate(item.end_date)}</Text>
                </View>
                <Text style={styles.rent}>{formatPrice(item.rent_amount)}/month</Text>

                {item.terms ? (
                  <View style={styles.termsBox}>
                    <FileText size={13} color="#94A3B8" style={styles.icon} />
                    <Text style={styles.termsText}>{item.terms}</Text>
                  </View>
                ) : null}

                {item.contract_url ? (
                  <View style={styles.infoRow}>
                    <LinkIcon size={13} color="#38BDF8" style={styles.icon} />
                    <Text style={styles.contractText} numberOfLines={1}>{item.contract_url}</Text>
                  </View>
                ) : null}

                {item.status !== 'terminated' ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openRenew(item)}>
                      <RefreshCw size={14} color="#38BDF8" style={styles.actionIcon} />
                      <Text style={styles.actionBtnText}>Renew</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleTerminate(item)}>
                      <Ban size={14} color="#EF4444" style={styles.actionIcon} />
                      <Text style={styles.deleteBtnText}>Terminate</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            )}
            contentContainerStyle={styles.listContainer}
            onRefresh={() => {
              fetchLeases();
              fetchOptions();
            }}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <FileText size={48} color="#94A3B8" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>No rental agreements yet.</Text>
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

      {/* Create Lease Modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Rental Agreement</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Tenant</Text>
                {tenants.length === 0 ? (
                  <Text style={styles.errorText}>No tenants found. Invite a tenant first.</Text>
                ) : (
                  tenants.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.optionBtn, selectedTenant === t.id && styles.optionBtnActive]}
                      onPress={() => setSelectedTenant(t.id)}
                    >
                      <Text style={[styles.optionText, selectedTenant === t.id && styles.optionTextActive]}>
                        {t.full_name} ({t.role})
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Property</Text>
                {properties.length === 0 ? (
                  <Text style={styles.errorText}>No rental properties found. Add one first.</Text>
                ) : (
                  properties.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.optionBtn, selectedProperty === p.id && styles.optionBtnActive]}
                      onPress={() => {
                        setSelectedProperty(p.id);
                        setSelectedUnit('');
                        setRentAmount(p.price.toString());
                      }}
                    >
                      <Text style={[styles.optionText, selectedProperty === p.id && styles.optionTextActive]}>
                        {p.title}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              {selectedProperty && units.length > 0 ? (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Unit (optional)</Text>
                  {units.map((u) => (
                    <TouchableOpacity
                      key={u.id}
                      style={[styles.optionBtn, selectedUnit === u.id && styles.optionBtnActive]}
                      onPress={() => {
                        setSelectedUnit(u.id);
                        setRentAmount(u.rent_amount.toString());
                      }}
                    >
                      <Text style={[styles.optionText, selectedUnit === u.id && styles.optionTextActive]}>
                        Unit {u.unit_number} ({formatPrice(u.rent_amount)})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Start Date</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#999"
                  value={startDate}
                  onChangeText={setStartDate}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>End Date</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#999"
                  value={endDate}
                  onChangeText={setEndDate}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Rent Amount (KES/month)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 25000"
                  placeholderTextColor="#999"
                  value={rentAmount}
                  onChangeText={setRentAmount}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Terms & Conditions (optional)</Text>
                <TextInput
                  style={[styles.modalInput, styles.textArea]}
                  placeholder="e.g. Deposit of 2 months, no subletting..."
                  placeholderTextColor="#999"
                  value={terms}
                  onChangeText={setTerms}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Contract URL (optional)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="https://... (uploaded contract link)"
                  placeholderTextColor="#999"
                  value={contractUrl}
                  onChangeText={setContractUrl}
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleCreate} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.submitBtnText}>Create Agreement</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Renew Modal */}
      <Modal animationType="fade" transparent visible={renewVisible} onRequestClose={() => setRenewVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Renew Agreement</Text>
              <TouchableOpacity onPress={() => setRenewVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>New End Date</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#999"
                  value={renewEndDate}
                  onChangeText={setRenewEndDate}
                />
              </View>
              <TouchableOpacity style={styles.submitBtn} onPress={handleRenew}>
                <Text style={styles.submitBtnText}>Confirm Renewal</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  listContainer: { padding: 16, flexGrow: 1 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: 'bold' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  icon: { marginRight: 8 },
  infoText: { color: '#94A3B8', fontSize: 13 },
  rent: { fontSize: 16, fontWeight: 'bold', color: '#38BDF8', marginVertical: 8 },
  termsBox: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  termsText: { color: '#94A3B8', fontSize: 12, flex: 1, lineHeight: 18 },
  contractText: { color: '#38BDF8', fontSize: 12, flex: 1 },
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
  textArea: { height: 80 },
  optionBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  optionBtnActive: { borderColor: '#38BDF8', backgroundColor: 'rgba(56, 189, 248, 0.1)' },
  optionText: { color: '#94A3B8', fontSize: 13 },
  optionTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  errorText: { color: '#EF4444', fontSize: 13 },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
