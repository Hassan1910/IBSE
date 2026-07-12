import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import {
  fetchAssignableUnits,
  hasOverlappingLease,
  leaseAssignErrorMessage,
  leaseTotalRent,
  promoteClientToTenant,
} from '../../lib/leases';
import DatePickerModal from '../../components/DatePickerModal';
import NotificationBell from '../../components/NotificationBell';
import { UserPlus, X, Mail, Phone, Home, Calendar, Users, FilePlus, FileText } from 'lucide-react-native';

interface LeaseRow {
  id: string;
  tenant_id: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  status: 'pending' | 'active' | 'terminated' | 'expired';
  properties: { title: string } | null;
  profiles: { full_name: string; email: string; phone: string | null } | null;
}

interface TenantGroup {
  tenantId: string;
  fullName: string;
  email: string;
  phone: string | null;
  leases: LeaseRow[];
  activeCount: number;
}

interface OptionProfile {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface OptionProperty {
  id: string;
  title: string;
  price: number;
}

interface OptionUnit {
  id: string;
  unit_number: string;
  rent_amount: number;
}

const todayISODate = () => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function LandlordTenants() {
  const { user } = useUser();
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Assign lease
  const [leaseModalVisible, setLeaseModalVisible] = useState(false);
  const [allTenantProfiles, setAllTenantProfiles] = useState<OptionProfile[]>([]);
  const [properties, setProperties] = useState<OptionProperty[]>([]);
  const [units, setUnits] = useState<OptionUnit[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedTenantName, setSelectedTenantName] = useState('');
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rentAmount, setRentAmount] = useState('');
  const [submittingLease, setSubmittingLease] = useState(false);
  const [loadingLeaseOptions, setLoadingLeaseOptions] = useState(false);
  const [lockTenantSelection, setLockTenantSelection] = useState(false);
  const [startDatePickerVisible, setStartDatePickerVisible] = useState(false);
  const [endDatePickerVisible, setEndDatePickerVisible] = useState(false);

  const fetchTenants = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id) return;
    try {
      if (!opts?.silent) setLoading(true);
      const { data, error } = await supabase
        .from('leases')
        .select('id, tenant_id, start_date, end_date, rent_amount, status, properties!inner ( title, owner_id ), profiles:tenant_id ( full_name, email, phone )')
        .eq('properties.owner_id', user.id)
        .order('start_date', { ascending: false });

      if (error) throw error;

      const groups = new Map<string, TenantGroup>();
      for (const lease of (data as any as LeaseRow[]) || []) {
        if (!lease.tenant_id) continue;
        let group = groups.get(lease.tenant_id);
        if (!group) {
          group = {
            tenantId: lease.tenant_id,
            fullName: lease.profiles?.full_name || 'Unknown Tenant',
            email: lease.profiles?.email || '',
            phone: lease.profiles?.phone ?? null,
            leases: [],
            activeCount: 0,
          };
          groups.set(lease.tenant_id, group);
        }
        group.leases.push(lease);
        if (lease.status === 'active' || lease.status === 'pending') group.activeCount += 1;
      }
      setTenants(Array.from(groups.values()));
    } catch (err) {
      console.error('Fetch tenants error:', err);
      Alert.alert('Error', 'Failed to load your tenants.');
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [user?.id]);

  // Tab screens stay mounted — refetch when focused after terminate elsewhere.
  useFocusEffect(
    useCallback(() => {
      fetchTenants({ silent: hasLoadedRef.current });
    }, [fetchTenants])
  );

  const fetchLeaseOptions = useCallback(async () => {
    if (!user?.id) return;
    setLoadingLeaseOptions(true);
    try {
      const [{ data: profs }, { data: props }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .in('role', ['tenant', 'client'])
          .order('full_name', { ascending: true }),
        supabase
          .from('properties')
          .select('id, title, price')
          .eq('type', 'rental')
          .eq('owner_id', user.id)
          .order('title', { ascending: true }),
      ]);
      setAllTenantProfiles((profs as OptionProfile[]) || []);
      setProperties((props as OptionProperty[]) || []);
    } catch (err) {
      console.error('Fetch lease options error:', err);
      Alert.alert('Error', 'Failed to load lease options.');
    } finally {
      setLoadingLeaseOptions(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!selectedPropertyId) {
      setUnits([]);
      return;
    }
    (async () => {
      try {
        const units = await fetchAssignableUnits(selectedPropertyId);
        setUnits(units);
      } catch (err) {
        console.error('Fetch assignable units error:', err);
        setUnits([]);
      }
    })();
  }, [selectedPropertyId]);

  const resetLeaseForm = () => {
    setSelectedTenantId('');
    setSelectedTenantName('');
    setSelectedPropertyId('');
    setSelectedUnitId('');
    setStartDate(todayISODate());
    setEndDate('');
    setRentAmount('');
    setLockTenantSelection(false);
  };

  const openAssignLease = async (opts?: { tenantId?: string; tenantName?: string }) => {
    resetLeaseForm();
    if (opts?.tenantId) {
      setSelectedTenantId(opts.tenantId);
      setSelectedTenantName(opts.tenantName || '');
      setLockTenantSelection(true);
    }
    setLeaseModalVisible(true);
    await fetchLeaseOptions();
  };

  const handleCreateTenant = async () => {
    const email = newEmail.trim().toLowerCase();
    const username = newUsername.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Validation Error', 'Please enter a valid email address.');
      return;
    }
    if (!username) {
      Alert.alert('Validation Error', 'Please enter a username.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Validation Error', 'Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Validation Error', 'Passwords do not match.');
      return;
    }

    try {
      setSubmittingCreate(true);

      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { email, username, role: 'tenant', password: newPassword },
      });

      if (error) {
        let message = 'Failed to create the tenant account.';
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const parsed = await ctx.json();
            if (parsed?.error) message = parsed.error;
          }
        } catch {
          // Ignore parse errors and fall back to the generic message.
        }
        Alert.alert('Error', message);
        return;
      }
      if (data?.error) {
        Alert.alert('Error', data.error);
        return;
      }

      logAudit({
        actorId: user?.id || '',
        action: 'create',
        entityType: 'user',
        entityId: data?.userId,
        description: `Created tenant account for ${email}`,
      });

      const createdUserId = data?.userId as string | undefined;
      setCreateModalVisible(false);
      setNewEmail('');
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');

      Alert.alert(
        'Tenant Account Created',
        `An account for ${email} was created. Share the login credentials with the tenant.\n\nAssign a lease now to link them to a property?`,
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Assign Lease',
            onPress: () => {
              if (createdUserId) {
                openAssignLease({ tenantId: createdUserId, tenantName: username });
              } else {
                openAssignLease();
              }
            },
          },
        ]
      );
    } catch (err: any) {
      console.error('Create tenant error:', err);
      Alert.alert('Error', err?.message || 'Failed to create the tenant account.');
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleAssignLease = async () => {
    if (!selectedTenantId || !selectedPropertyId || !startDate || !endDate || !rentAmount) {
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

    if (endDate < startDate) {
      Alert.alert('Validation Error', 'End date must be on or after the start date.');
      return;
    }

    try {
      setSubmittingLease(true);

      const overlaps = await hasOverlappingLease({
        propertyId: selectedPropertyId,
        unitId: selectedUnitId || null,
        startDate,
        endDate,
      });
      if (overlaps) {
        Alert.alert(
          'Space Unavailable',
          'This space already has a pending or active lease for overlapping dates. Terminate or renew the existing agreement instead.'
        );
        return;
      }

      const { error: leaseError } = await supabase.from('leases').insert({
        property_id: selectedPropertyId,
        unit_id: selectedUnitId || null,
        tenant_id: selectedTenantId,
        owner_id: user.id,
        start_date: startDate,
        end_date: endDate,
        rent_amount: rent,
        status: 'pending',
      });
      if (leaseError) throw leaseError;

      // Promote client → tenant when allocating a lease.
      // Unit/property occupancy flips to rented when the first payment is verified.
      const profile = allTenantProfiles.find((p) => p.id === selectedTenantId);
      await promoteClientToTenant(selectedTenantId, profile?.role);

      logAudit({
        actorId: user.id,
        action: 'create',
        entityType: 'lease',
        entityId: selectedTenantId,
        description: `Assigned pending lease to ${selectedTenantName || profile?.full_name || selectedTenantId}`,
      });

      Alert.alert(
        'Lease Assigned',
        'Agreement is pending payment. It becomes active after the tenant pays and you verify the payment.'
      );
      setLeaseModalVisible(false);
      resetLeaseForm();
      fetchTenants();
    } catch (err) {
      console.error('Assign lease error:', err);
      Alert.alert('Error', leaseAssignErrorMessage(err));
    } finally {
      setSubmittingLease(false);
    }
  };

  const formatPrice = (p: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(p);

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Tenants</Text>
        <NotificationBell href="/(landlord)/notifications" />
      </View>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          <FlatList
            data={tenants}
            keyExtractor={(item) => item.tenantId}
            ListHeaderComponent={
              <TouchableOpacity
                style={styles.manageLink}
                onPress={() => router.push('/(landlord)/agreements')}
              >
                <FileText size={16} color="#38BDF8" style={{ marginRight: 8 }} />
                <Text style={styles.manageLinkText}>Manage all rental agreements</Text>
              </TouchableOpacity>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.name}>{item.fullName}</Text>
                  <View style={[styles.badge, item.activeCount === 0 && styles.badgeInactive]}>
                    <Text style={[styles.badgeText, item.activeCount === 0 && styles.badgeTextInactive]}>
                      {(() => {
                        const active = item.leases.filter((l) => l.status === 'active').length;
                        const pending = item.leases.filter((l) => l.status === 'pending').length;
                        if (active === 0 && pending === 0) return 'INACTIVE';
                        const parts: string[] = [];
                        if (active > 0) parts.push(`${active} ACTIVE`);
                        if (pending > 0) parts.push(`${pending} PENDING`);
                        return parts.join(' · ');
                      })()}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Mail size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>{item.email || 'No email'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Phone size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>{item.phone || 'No phone number'}</Text>
                </View>

                <View style={styles.divider} />
                <Text style={styles.historyTitle}>Rental History</Text>
                {item.leases.map((l) => (
                  <View key={l.id} style={styles.historyRow}>
                    <Home size={13} color="#94A3B8" style={styles.icon} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyProp}>{l.properties?.title || 'Property'}</Text>
                      <View style={styles.historyMeta}>
                        <Calendar size={11} color="#64748B" style={{ marginRight: 4 }} />
                        <Text style={styles.historyDate}>
                          {formatDate(l.start_date)} - {formatDate(l.end_date)}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.historyRent}>
                        {formatPrice(leaseTotalRent(l.rent_amount, l.start_date, l.end_date))}
                      </Text>
                      <Text
                        style={[
                          styles.historyStatus,
                          {
                            color:
                              l.status === 'active'
                                ? '#10B981'
                                : l.status === 'pending'
                                  ? '#EAB308'
                                  : l.status === 'expired'
                                    ? '#94A3B8'
                                    : '#EF4444',
                          },
                        ]}
                      >
                        {l.status === 'pending' ? 'PENDING PAYMENT' : l.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                ))}

                <TouchableOpacity
                  style={styles.assignBtn}
                  onPress={() => openAssignLease({ tenantId: item.tenantId, tenantName: item.fullName })}
                >
                  <FilePlus size={14} color="#0F172A" style={{ marginRight: 6 }} />
                  <Text style={styles.assignBtnText}>Assign Lease</Text>
                </TouchableOpacity>
              </View>
            )}
            contentContainerStyle={styles.listContainer}
            onRefresh={fetchTenants}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <Users size={48} color="#94A3B8" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>
                  No tenants yet. Create a tenant account, then assign a lease to link them to a property.
                </Text>
                <TouchableOpacity style={styles.emptyAssignBtn} onPress={() => openAssignLease()}>
                  <Text style={styles.assignBtnText}>Assign Lease</Text>
                </TouchableOpacity>
              </View>
            }
          />

          <View style={styles.fabColumn}>
            <TouchableOpacity style={[styles.fab, styles.fabSecondary]} onPress={() => openAssignLease()}>
              <FilePlus size={22} color="#F8FAFC" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fab} onPress={() => setCreateModalVisible(true)}>
              <UserPlus size={24} color="#0F172A" />
            </TouchableOpacity>
          </View>
        </>
      )}

      <Modal animationType="slide" transparent visible={createModalVisible} onRequestClose={() => setCreateModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Tenant Account</Text>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inviteNote}>
                <Mail size={16} color="#38BDF8" style={{ marginRight: 8 }} />
                <Text style={styles.inviteNoteText}>
                  Create a complete login account. The tenant signs in with the email and password you set
                  here, and can change their password later from their profile.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="name@domain.com"
                  placeholderTextColor="#999"
                  value={newEmail}
                  onChangeText={setNewEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Jane Doe"
                  placeholderTextColor="#999"
                  value={newUsername}
                  onChangeText={setNewUsername}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="At least 8 characters"
                  placeholderTextColor="#999"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Re-enter the password"
                  placeholderTextColor="#999"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleCreateTenant} disabled={submittingCreate}>
                {submittingCreate ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>Create Account</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={leaseModalVisible}
        onRequestClose={() => setLeaseModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign Lease</Text>
              <TouchableOpacity onPress={() => setLeaseModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              {loadingLeaseOptions ? (
                <ActivityIndicator color="#38BDF8" style={{ marginVertical: 24 }} />
              ) : (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Tenant</Text>
                    {lockTenantSelection && selectedTenantId ? (
                      <Text style={styles.modalSubText}>
                        {selectedTenantName ||
                          allTenantProfiles.find((p) => p.id === selectedTenantId)?.full_name ||
                          'Selected tenant'}
                      </Text>
                    ) : allTenantProfiles.length === 0 ? (
                      <Text style={styles.errorText}>No tenants found. Create a tenant account first.</Text>
                    ) : (
                      allTenantProfiles.map((t) => (
                        <TouchableOpacity
                          key={t.id}
                          style={[styles.optionBtn, selectedTenantId === t.id && styles.optionBtnActive]}
                          onPress={() => {
                            setSelectedTenantId(t.id);
                            setSelectedTenantName(t.full_name);
                          }}
                        >
                          <Text
                            style={[styles.optionText, selectedTenantId === t.id && styles.optionTextActive]}
                          >
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
                          style={[styles.optionBtn, selectedPropertyId === p.id && styles.optionBtnActive]}
                          onPress={() => {
                            setSelectedPropertyId(p.id);
                            setSelectedUnitId('');
                            setRentAmount(p.price.toString());
                          }}
                        >
                          <Text
                            style={[
                              styles.optionText,
                              selectedPropertyId === p.id && styles.optionTextActive,
                            ]}
                          >
                            {p.title} ({formatPrice(p.price)})
                          </Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>

                  {selectedPropertyId && units.length > 0 ? (
                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>Unit (optional)</Text>
                      {units.map((u) => (
                        <TouchableOpacity
                          key={u.id}
                          style={[styles.optionBtn, selectedUnitId === u.id && styles.optionBtnActive]}
                          onPress={() => {
                            setSelectedUnitId(u.id);
                            setRentAmount(u.rent_amount.toString());
                          }}
                        >
                          <Text
                            style={[styles.optionText, selectedUnitId === u.id && styles.optionTextActive]}
                          >
                            Unit {u.unit_number} ({formatPrice(u.rent_amount)})
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Start Date</Text>
                    <View style={styles.dateInputContainer}>
                      <TextInput
                        style={[styles.modalInput, { flex: 1 }]}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#999"
                        value={startDate}
                        onChangeText={setStartDate}
                      />
                      <TouchableOpacity
                        style={styles.calendarIconBtn}
                        onPress={() => setStartDatePickerVisible(true)}
                      >
                        <Calendar size={20} color="#38BDF8" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>End Date</Text>
                    <View style={styles.dateInputContainer}>
                      <TextInput
                        style={[styles.modalInput, { flex: 1 }]}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#999"
                        value={endDate}
                        onChangeText={setEndDate}
                      />
                      <TouchableOpacity
                        style={styles.calendarIconBtn}
                        onPress={() => setEndDatePickerVisible(true)}
                      >
                        <Calendar size={20} color="#38BDF8" />
                      </TouchableOpacity>
                    </View>
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

                  <TouchableOpacity
                    style={styles.submitBtn}
                    onPress={handleAssignLease}
                    disabled={submittingLease || properties.length === 0}
                  >
                    {submittingLease ? (
                      <ActivityIndicator color="#0F172A" />
                    ) : (
                      <Text style={styles.submitBtnText}>Assign Lease</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <DatePickerModal
        visible={startDatePickerVisible}
        onClose={() => setStartDatePickerVisible(false)}
        value={startDate}
        onChange={setStartDate}
        title="Select Start Date"
      />

      <DatePickerModal
        visible={endDatePickerVisible}
        onClose={() => setEndDatePickerVisible(false)}
        value={endDate}
        onChange={setEndDate}
        title="Select End Date"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  topBarTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 12 },
  listContainer: { padding: 16, flexGrow: 1 },
  manageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  manageLinkText: { color: '#38BDF8', fontSize: 14, fontWeight: '600' },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  name: { fontSize: 16, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 8 },
  badge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeInactive: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderColor: '#94A3B8',
  },
  badgeText: { color: '#10B981', fontSize: 10, fontWeight: 'bold' },
  badgeTextInactive: { color: '#94A3B8' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  icon: { marginRight: 8 },
  infoText: { color: '#94A3B8', fontSize: 13 },
  divider: { height: 1, backgroundColor: '#334155', marginVertical: 12 },
  historyTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: 'bold', marginBottom: 8 },
  historyRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  historyProp: { color: '#F8FAFC', fontSize: 13, fontWeight: '600' },
  historyMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  historyDate: { color: '#64748B', fontSize: 11 },
  historyRent: { color: '#38BDF8', fontSize: 13, fontWeight: 'bold' },
  historyStatus: { fontSize: 10, fontWeight: 'bold', marginTop: 2 },
  assignBtn: {
    marginTop: 8,
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  assignBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 13 },
  emptyAssignBtn: {
    marginTop: 16,
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  fabColumn: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    alignItems: 'center',
    gap: 12,
  },
  fab: {
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
  fabSecondary: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#38BDF8',
    shadowColor: '#000',
    shadowOpacity: 0.3,
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
  modalSubText: { color: '#F8FAFC', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  modalBody: { paddingBottom: 20 },
  inviteNote: {
    flexDirection: 'row',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  inviteNoteText: { color: '#94A3B8', fontSize: 12, lineHeight: 18, flex: 1 },
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
  dateInputContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  calendarIconBtn: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  optionBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  optionBtnActive: { borderColor: '#38BDF8', backgroundColor: 'rgba(56, 189, 248, 0.12)' },
  optionText: { color: '#94A3B8', fontSize: 14 },
  optionTextActive: { color: '#38BDF8', fontWeight: '600' },
  errorText: { color: '#F87171', fontSize: 13, lineHeight: 18 },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
