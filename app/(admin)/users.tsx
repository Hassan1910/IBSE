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
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { useAudit } from '../../hooks/useAudit';
import { X, Shield, Calendar, Trash2, UserPlus, KeyRound, Mail } from 'lucide-react-native';
import DatePickerModal from '../../components/DatePickerModal';

interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
}

type InviteRole = 'admin' | 'finance' | 'booking' | 'tenant' | 'client' | 'landlord';

interface Property {
  id: string;
  title: string;
  price: number;
  owner_id?: string | null;
}

export default function AdminUsersScreen() {
  const { user: currentUser } = useUser();
  const { log } = useAudit();
  const [users, setUsers] = useState<Profile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [rentalPropertyCount, setRentalPropertyCount] = useState(0);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [loading, setLoading] = useState(true);

  // Create account modal states
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('client');
  const [submittingInvite, setSubmittingInvite] = useState(false);

  // Lease Modal States
  const [leaseModalVisible, setLeaseModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rentAmount, setRentAmount] = useState('');
  const [submittingLease, setSubmittingLease] = useState(false);
  const [startDatePickerVisible, setStartDatePickerVisible] = useState(false);
  const [endDatePickerVisible, setEndDatePickerVisible] = useState(false);

  // Role Edit Modal
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'admin' | 'finance' | 'booking' | 'tenant' | 'client' | 'landlord'>('client');

  const fetchAvailableProperties = async () => {
    try {
      setLoadingProperties(true);

      const [
        { data: propData, error: propError },
        { data: activeLeases, error: leaseError },
        { count: rentalCount, error: countError },
      ] = await Promise.all([
        supabase
          .from('properties')
          .select('id, title, price, owner_id')
          .eq('type', 'rental')
          .eq('status', 'available')
          .order('title', { ascending: true }),
        supabase.from('leases').select('property_id').eq('status', 'active'),
        supabase
          .from('properties')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'rental'),
      ]);

      if (propError) throw propError;
      if (leaseError) throw leaseError;
      if (countError) throw countError;

      const leasedPropertyIds = new Set((activeLeases ?? []).map((lease) => lease.property_id));
      const available = (propData ?? []).filter((property) => !leasedPropertyIds.has(property.id));

      setProperties(available);
      setRentalPropertyCount(rentalCount ?? 0);
    } catch (err: any) {
      console.error('Fetch available properties error:', err);
      Alert.alert('Error', 'Failed to load available rental properties.');
    } finally {
      setLoadingProperties(false);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);

      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true });

      if (userError) throw userError;
      setUsers(userData || []);

      await fetchAvailableProperties();
    } catch (err: any) {
      console.error('Fetch admin data error:', err);
      Alert.alert('Error', 'Failed to retrieve user registry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdateRole = async () => {
    if (!selectedUser) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: selectedRole })
        .eq('id', selectedUser.id);

      if (error) throw error;

      log({
        action: 'update',
        entityType: 'user',
        entityId: selectedUser.id,
        description: `Set ${selectedUser.full_name} role to ${selectedRole}`,
      });
      Alert.alert('Success', `${selectedUser.full_name}'s role updated to ${selectedRole}.`);
      setRoleModalVisible(false);
      fetchData();
    } catch (err: any) {
      console.error('Update role error:', err);
      Alert.alert('Error', 'Failed to update user role.');
    }
  };

  const handleCreateUser = async () => {
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
      setSubmittingInvite(true);

      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { email, username, role: inviteRole, password: newPassword },
      });

      // Supabase surfaces non-2xx responses as an error; try to read the message.
      if (error) {
        let message = 'Failed to create the user account.';
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

      log({
        action: 'create',
        entityType: 'user',
        entityId: data?.userId,
        description: `Created account for ${email} as ${inviteRole}`,
      });
      Alert.alert(
        'Account Created',
        `An account for ${email} was created with the ${inviteRole} role. Share these login credentials with the user:\n\nEmail: ${email}\nPassword: (the one you set)\n\nThey can change their password later from their profile.`,
      );
      setInviteModalVisible(false);
      setNewEmail('');
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
      setInviteRole('client');
      fetchData();
    } catch (err: any) {
      console.error('Create user error:', err);
      Alert.alert('Error', err?.message || 'Failed to create the user account.');
    } finally {
      setSubmittingInvite(false);
    }
  };

  const handleResetPassword = (user: Profile) => {
    // Passwords are managed by Clerk (the identity provider). An admin cannot
    // set another user's password from the client, so we trigger the secure
    // self-service reset flow: the user receives a reset link/code by email.
    Alert.alert(
      'Reset Password',
      `Send a password reset instruction to ${user.email}? They will use the "Forgot password" flow to set a new password securely.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            log({
              action: 'reset_password',
              entityType: 'user',
              entityId: user.id,
              description: `Requested password reset for ${user.email}`,
            });
            Alert.alert(
              'Reset Requested',
              `${user.full_name} should open the app, tap "Forgot password", and follow the emailed instructions. This request has been logged.`,
            );
          },
        },
      ],
    );
  };

  const handleDeleteUser = (id: string, fullName: string) => {
    Alert.alert(
      'Delete User Profile',
      `Are you sure you want to permanently delete ${fullName}? This will also delete their leases, bookings, and payments. Their authentication account may still exist.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const { error } = await supabase.from('profiles').delete().eq('id', id);
              if (error) throw error;
              log({ action: 'delete', entityType: 'user', entityId: id, description: `Deleted ${fullName}` });
              Alert.alert('Success', 'User profile deleted.');
              setUsers(prev => prev.filter(u => u.id !== id));
            } catch (err) {
              console.error('Delete user error:', err);
              Alert.alert('Error', 'Failed to delete user.');
            }
          }
        }
      ]
    );
  };

  const handleCreateLease = async () => {
    if (!selectedUser || !selectedPropertyId || !startDate || !endDate || !rentAmount) {
      Alert.alert('Validation Error', 'Please fill in all lease details.');
      return;
    }

    const rentNum = parseFloat(rentAmount);
    if (isNaN(rentNum) || rentNum <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid monthly rent amount.');
      return;
    }

    try {
      setSubmittingLease(true);

      // Find property owner_id
      const selectedProp = properties.find((p) => p.id === selectedPropertyId);
      const ownerId = selectedProp?.owner_id || currentUser?.id || null;

      // 1. Insert lease record
      const { error: leaseError } = await supabase.from('leases').insert({
        property_id: selectedPropertyId,
        tenant_id: selectedUser.id,
        owner_id: ownerId,
        start_date: startDate,
        end_date: endDate,
        rent_amount: rentNum,
        status: 'active',
      });

      if (leaseError) throw leaseError;

      // 2. Mark property as rented
      const { error: propError } = await supabase
        .from('properties')
        .update({ status: 'rented' })
        .eq('id', selectedPropertyId);

      if (propError) throw propError;

      // 3. Auto-update user's role to 'tenant' if they are listed as 'client'
      if (selectedUser.role === 'client') {
        await supabase
          .from('profiles')
          .update({ role: 'tenant' })
          .eq('id', selectedUser.id);
      }

      log({
        action: 'create',
        entityType: 'lease',
        entityId: selectedUser.id,
        description: `Allocated lease to ${selectedUser.full_name}`,
      });
      Alert.alert('Lease Assigned 🎉', `Active lease created successfully for ${selectedUser.full_name}.`);
      setLeaseModalVisible(false);
      // Reset form fields
      setSelectedPropertyId('');
      setStartDate('');
      setEndDate('');
      setRentAmount('');
      fetchData();
    } catch (err: any) {
      console.error('Create lease error:', err);
      Alert.alert('Error', 'Failed to create active lease.');
    } finally {
      setSubmittingLease(false);
    }
  };

  const openLeaseModal = async (user: Profile) => {
    setSelectedUser(user);
    setSelectedPropertyId('');
    setStartDate('');
    setEndDate('');
    setRentAmount('');
    setLeaseModalVisible(true);
    await fetchAvailableProperties();
  };

  const openRoleModal = (user: Profile) => {
    setSelectedUser(user);
    setSelectedRole(user.role as any);
    setRoleModalVisible(true);
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
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.name}>{item.full_name}</Text>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleText}>{item.role.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.subText}>{item.email}</Text>
              <Text style={styles.subText}>{item.phone || 'No phone number synced'}</Text>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.roleBtn]}
                  onPress={() => openRoleModal(item)}
                >
                  <Shield size={14} color="#38BDF8" style={styles.btnIcon} />
                  <Text style={styles.roleBtnText}>Change Role</Text>
                </TouchableOpacity>

                {item.role !== 'admin' && (
                  <TouchableOpacity
                    style={[styles.btn, styles.leaseBtn]}
                    onPress={() => openLeaseModal(item)}
                  >
                    <Calendar size={14} color="#0F172A" style={styles.btnIcon} />
                    <Text style={styles.leaseBtnText}>Allocate Lease</Text>
                  </TouchableOpacity>
                )}
                
                {item.role !== 'admin' && (
                  <TouchableOpacity
                    style={[styles.btn, styles.deleteUserBtn]}
                    onPress={() => handleDeleteUser(item.id, item.full_name)}
                  >
                    <Trash2 size={14} color="#EF4444" style={styles.btnIcon} />
                    <Text style={styles.deleteUserBtnText}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={styles.resetRow}
                onPress={() => handleResetPassword(item)}
              >
                <KeyRound size={13} color="#94A3B8" style={styles.btnIcon} />
                <Text style={styles.resetRowText}>Reset password</Text>
              </TouchableOpacity>
            </View>
          )}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchData}
          refreshing={loading}
        />
        <TouchableOpacity style={styles.fab} onPress={() => setInviteModalVisible(true)}>
          <UserPlus size={24} color="#0F172A" />
        </TouchableOpacity>
        </>
      )}

      {/* Invite / Create User Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={inviteModalVisible}
        onRequestClose={() => setInviteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create User Account</Text>
              <TouchableOpacity onPress={() => setInviteModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inviteNote}>
                <Mail size={16} color="#38BDF8" style={{ marginRight: 8 }} />
                <Text style={styles.inviteNoteText}>
                  Create a complete login account. The user signs in with the email and password you set
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Assign Role</Text>
                <View style={styles.roleSelectionRow}>
                  {(['client', 'tenant', 'landlord', 'booking', 'finance', 'admin'] as InviteRole[]).map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.roleSelectBtn, inviteRole === r && styles.roleSelectBtnActive]}
                      onPress={() => setInviteRole(r)}
                    >
                      <Text style={[styles.roleSelectText, inviteRole === r && styles.roleSelectTextActive]}>
                        {r.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleCreateUser} disabled={submittingInvite}>
                {submittingInvite ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>Create Account</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Role Update Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={roleModalVisible}
        onRequestClose={() => setRoleModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change System Role</Text>
              <TouchableOpacity onPress={() => setRoleModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <View style={styles.modalBody}>
                <Text style={styles.modalSubText}>User: {selectedUser.full_name}</Text>
                
                <View style={styles.roleSelectionRow}>
                  {['client', 'tenant', 'landlord', 'booking', 'finance', 'admin'].map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[
                        styles.roleSelectBtn,
                        selectedRole === r && styles.roleSelectBtnActive,
                      ]}
                      onPress={() => setSelectedRole(r as any)}
                    >
                      <Text
                        style={[
                          styles.roleSelectText,
                          selectedRole === r && styles.roleSelectTextActive,
                        ]}
                      >
                        {r.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity style={styles.submitBtn} onPress={handleUpdateRole}>
                  <Text style={styles.submitBtnText}>Update Role</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Assign Lease Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={leaseModalVisible}
        onRequestClose={() => setLeaseModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Allocate Lease Agreement</Text>
              <TouchableOpacity onPress={() => setLeaseModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalSubText}>Tenant: {selectedUser.full_name}</Text>

                {/* Property Selection */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Select Available Property</Text>
                  {loadingProperties ? (
                    <ActivityIndicator color="#38BDF8" style={styles.propertyLoader} />
                  ) : properties.length === 0 ? (
                    <Text style={styles.errorText}>
                      {rentalPropertyCount === 0
                        ? 'No rental listings found. Go to Manage Properties and add a rental listing first.'
                        : 'All rental properties are currently leased. Mark a property as Available in Manage Properties, or terminate an existing lease to free one up.'}
                    </Text>
                  ) : (
                    <View style={styles.propertyGrid}>
                      {properties.map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          style={[
                            styles.propertyBtn,
                            selectedPropertyId === p.id && styles.propertyBtnActive,
                          ]}
                          onPress={() => {
                            setSelectedPropertyId(p.id);
                            setRentAmount(p.price.toString());
                          }}
                        >
                          <Text
                            style={[
                              styles.propertyText,
                              selectedPropertyId === p.id && styles.propertyTextActive,
                            ]}
                          >
                            {p.title} (KES {p.price})
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* Dates */}
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

                {/* Rent Amount */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Lease Rent Amount (KES/month)</Text>
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
                  onPress={handleCreateLease}
                  disabled={submittingLease || loadingProperties || properties.length === 0}
                >
                  {submittingLease ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.submitBtnText}>Activate Lease</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Date Pickers */}
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
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  listContainer: {
    padding: 16,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  roleBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderColor: '#38BDF8',
    borderWidth: 1,
  },
  roleText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: 'bold',
  },
  subText: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 4,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  roleBtn: {
    borderColor: '#38BDF8',
    borderWidth: 1,
    marginRight: 6,
  },
  roleBtnText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 13,
  },
  leaseBtn: {
    backgroundColor: '#38BDF8',
    marginLeft: 6,
  },
  leaseBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 13,
  },
  btnIcon: {
    marginRight: 6,
  },
  deleteUserBtn: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderWidth: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    marginLeft: 6,
  },
  deleteUserBtnText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 13,
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  resetRowText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
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
  inviteNote: {
    flexDirection: 'row',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  inviteNoteText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  modalSubText: {
    fontSize: 15,
    color: '#38BDF8',
    fontWeight: '600',
    marginBottom: 16,
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
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleSelectionRow: {
    marginVertical: 10,
  },
  roleSelectBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  roleSelectBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  roleSelectText: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  roleSelectTextActive: {
    color: '#38BDF8',
    fontWeight: 'bold',
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
  propertyLoader: {
    marginVertical: 8,
  },
  propertyGrid: {
    marginVertical: 4,
  },
  propertyBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  propertyBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  propertyText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  propertyTextActive: {
    color: '#38BDF8',
    fontWeight: 'bold',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
  },
});
