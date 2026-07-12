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
import { useQueryClient } from '@tanstack/react-query';
import { useAudit } from '../../hooks/useAudit';
import {
  AssignableUnit,
  fetchAssignableUnits,
  hasOverlappingLease,
  leaseAssignErrorMessage,
  promoteClientToTenant,
} from '../../lib/leases';
import { createInvite, type InviteRole as InviteEmailRole } from '../../lib/invites';
import {
  fetchPendingLandlordRequests,
  resolveLandlordRequest,
  type LandlordAccountRequest,
} from '../../lib/landlordRequests';
import { X, Shield, Calendar, Trash2, UserPlus, KeyRound, Mail, Users } from 'lucide-react-native';
import DatePickerModal from '../../components/DatePickerModal';
import { useInfiniteList } from '../../hooks/queries/useInfiniteList';
import { fetchAdminUsersPage } from '../../hooks/queries/fetchers';
import { queryKeys } from '../../hooks/queries/keys';
import { LIST_PERF, PAGE_SIZE } from '../../lib/queryClient';

interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
}

type InviteRole = 'admin' | 'finance' | 'tenant' | 'client' | 'landlord';
type ProvisionMode = 'account' | 'invite';

interface Property {
  id: string;
  title: string;
  price: number;
  owner_id?: string | null;
}

async function edgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context;
    if (ctx && typeof ctx.json === 'function') {
      const parsed = await ctx.json();
      if (parsed?.error) return parsed.error;
    }
  } catch {
    // Ignore parse errors and fall back.
  }
  return fallback;
}

const todayISODate = () => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function AdminUsersScreen() {
  const { user } = useUser();
  const { log } = useAudit();
  const queryClient = useQueryClient();
  const {
    items: users,
    loading,
    refreshing,
    loadingMore,
    error,
    refresh,
    loadMore,
  } = useInfiniteList<Profile>(
    queryKeys.adminUsers,
    (page) => fetchAdminUsersPage(page) as Promise<Profile[]>,
    PAGE_SIZE.tables
  );
  const [properties, setProperties] = useState<Property[]>([]);
  const [rentalPropertyCount, setRentalPropertyCount] = useState(0);
  const [loadingProperties, setLoadingProperties] = useState(false);

  const invalidateUsers = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });

  // Create account / invite modal states
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [provisionMode, setProvisionMode] = useState<ProvisionMode>('account');
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
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [units, setUnits] = useState<AssignableUnit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rentAmount, setRentAmount] = useState('');
  const [submittingLease, setSubmittingLease] = useState(false);
  const [startDatePickerVisible, setStartDatePickerVisible] = useState(false);
  const [endDatePickerVisible, setEndDatePickerVisible] = useState(false);

  // Role Edit Modal
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'admin' | 'finance' | 'tenant' | 'client' | 'landlord'>('client');

  const [landlordRequests, setLandlordRequests] = useState<LandlordAccountRequest[]>([]);
  const [loadingLandlordRequests, setLoadingLandlordRequests] = useState(false);
  const [fulfillingRequestId, setFulfillingRequestId] = useState<string | null>(null);

  const loadLandlordRequests = async () => {
    try {
      setLoadingLandlordRequests(true);
      const rows = await fetchPendingLandlordRequests();
      setLandlordRequests(rows);
    } catch (err) {
      console.error('Fetch landlord account requests error:', err);
    } finally {
      setLoadingLandlordRequests(false);
    }
  };

  const fetchAvailableProperties = async () => {
    try {
      setLoadingProperties(true);

      const [
        { data: propData, error: propError },
        { count: rentalCount, error: countError },
      ] = await Promise.all([
        supabase
          .from('properties')
          .select('id, title, price, owner_id')
          .eq('type', 'rental')
          .eq('status', 'available')
          .order('title', { ascending: true }),
        supabase
          .from('properties')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'rental'),
      ]);

      if (propError) throw propError;
      if (countError) throw countError;

      setProperties(propData ?? []);
      setRentalPropertyCount(rentalCount ?? 0);
    } catch (err: any) {
      console.error('Fetch available properties error:', err);
      Alert.alert('Error', 'Failed to load available rental properties.');
    } finally {
      setLoadingProperties(false);
    }
  };

  useEffect(() => {
    if (error) {
      console.error('Fetch admin data error:', error);
      Alert.alert('Error', 'Failed to retrieve user registry.');
    }
  }, [error]);

  useEffect(() => {
    fetchAvailableProperties();
    void loadLandlordRequests();
  }, []);

  const openCreateFromLandlordRequest = (request: LandlordAccountRequest) => {
    setFulfillingRequestId(request.id);
    setProvisionMode('account');
    setInviteRole('landlord');
    setNewEmail(request.email);
    setNewUsername(request.full_name);
    setNewPassword('');
    setConfirmPassword('');
    setInviteModalVisible(true);
  };

  const handleDismissLandlordRequest = (request: LandlordAccountRequest) => {
    if (!user?.id) return;
    Alert.alert(
      'Dismiss request',
      `Dismiss the landlord request from ${request.full_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: async () => {
            try {
              await resolveLandlordRequest(request.id, 'dismissed', user.id);
              log({
                action: 'update',
                entityType: 'landlord_account_request',
                entityId: request.id,
                description: `Dismissed landlord request from ${request.email}`,
              });
              await loadLandlordRequests();
            } catch (err: any) {
              console.error('Dismiss landlord request error:', err);
              Alert.alert('Error', err?.message || 'Failed to dismiss request.');
            }
          },
        },
      ],
    );
  };

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
      await invalidateUsers();
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

    if (provisionMode === 'invite') {
      if (inviteRole === 'landlord') {
        Alert.alert(
          'Use Create Account',
          'Landlord accounts must be created directly (not invited). Switch to Create Account.',
        );
        return;
      }
      try {
        setSubmittingInvite(true);
        await createInvite({
          email,
          role: inviteRole as InviteEmailRole,
          fullName: username || null,
          invitedBy: user?.id ?? null,
        });

        let inviteMessage = `${email} can now sign up. Their role will be set to ${inviteRole} automatically.`;
        try {
          const { data: inviteResult, error: inviteSendError } = await supabase.functions.invoke(
            'send-invite-email',
            { body: { email, role: inviteRole, fullName: username || null } },
          );
          if (!inviteSendError && inviteResult?.signupUrl) {
            inviteMessage = inviteResult.emailSent
              ? `Invite email sent to ${email}. Signup link: ${inviteResult.signupUrl}`
              : `Invite saved. Share this signup link with ${email}:\n\n${inviteResult.signupUrl}`;
          }
        } catch (sendErr) {
          console.warn('Invite email send skipped:', sendErr);
        }

        log({
          action: 'create',
          entityType: 'invite',
          description: `Invited ${email} as ${inviteRole}`,
        });
        Alert.alert('Invite Saved', inviteMessage);
        setInviteModalVisible(false);
        setNewEmail('');
        setNewUsername('');
        setInviteRole('client');
      } catch (err: any) {
        console.error('Create invite error:', err);
        Alert.alert('Error', err?.message || 'Failed to create invite.');
      } finally {
        setSubmittingInvite(false);
      }
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
        Alert.alert('Error', await edgeFunctionErrorMessage(error, 'Failed to create the user account.'));
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

      if (fulfillingRequestId && inviteRole === 'landlord' && user?.id) {
        try {
          await resolveLandlordRequest(fulfillingRequestId, 'fulfilled', user.id);
          log({
            action: 'update',
            entityType: 'landlord_account_request',
            entityId: fulfillingRequestId,
            description: `Fulfilled landlord request for ${email}`,
          });
        } catch (resolveErr) {
          console.warn('Failed to mark landlord request fulfilled:', resolveErr);
        }
      }

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
      setFulfillingRequestId(null);
      await invalidateUsers();
      await loadLandlordRequests();
    } catch (err: any) {
      console.error('Create user error:', err);
      Alert.alert('Error', err?.message || 'Failed to create the user account.');
    } finally {
      setSubmittingInvite(false);
    }
  };

  const handleResetPassword = (user: Profile) => {
    Alert.alert(
      'Reset Password',
      `Force ${user.full_name} (${user.email}) to set a new password on their next sign-in? All of their active sessions will be signed out.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Force Reset',
          onPress: async () => {
            try {
              const { data, error } = await supabase.functions.invoke('admin-reset-password', {
                body: { userId: user.id },
              });
              if (error) {
                Alert.alert(
                  'Error',
                  await edgeFunctionErrorMessage(error, 'Failed to force password reset.'),
                );
                return;
              }
              if (data?.error) {
                Alert.alert('Error', data.error);
                return;
              }
              log({
                action: 'reset_password',
                entityType: 'user',
                entityId: user.id,
                description: `Forced password reset for ${user.email}`,
              });
              Alert.alert(
                'Password Reset Required',
                `${user.full_name} must sign in again and set a new password. Their existing sessions have been revoked.`,
              );
            } catch (err: any) {
              console.error('Reset password error:', err);
              Alert.alert('Error', err?.message || 'Failed to force password reset.');
            }
          },
        },
      ],
    );
  };

  const handleDeleteUser = (id: string, fullName: string) => {
    Alert.alert(
      'Delete User',
      `Permanently delete ${fullName}? This removes their login and profile, including related leases, bookings, and payments.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.functions.invoke('admin-delete-user', {
                body: { userId: id },
              });
              if (error) {
                Alert.alert('Error', await edgeFunctionErrorMessage(error, 'Failed to delete user.'));
                return;
              }
              if (data?.error) {
                Alert.alert('Error', data.error);
                return;
              }
              log({
                action: 'delete',
                entityType: 'user',
                entityId: id,
                description: `Deleted ${fullName}`,
              });
              Alert.alert('Success', 'User account deleted.');
              await invalidateUsers();
            } catch (err) {
              console.error('Delete user error:', err);
              Alert.alert('Error', 'Failed to delete user.');
            }
          },
        },
      ],
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
    if (endDate < startDate) {
      Alert.alert('Validation Error', 'End date must be on or after the start date.');
      return;
    }
    if (units.length > 0 && !selectedUnitId) {
      Alert.alert('Validation Error', 'Please select a unit for this property.');
      return;
    }

    try {
      setSubmittingLease(true);

      // Find property owner — do not fall back to the admin's id, or the
      // landlord dashboard will never see this lease under RLS.
      const selectedProp = properties.find((p) => p.id === selectedPropertyId);
      const ownerId = selectedProp?.owner_id || null;
      if (!ownerId) {
        Alert.alert(
          'Missing Landlord',
          'Assign a landlord to this property before creating a lease.',
        );
        return;
      }

      const unitId = selectedUnitId || null;
      const overlaps = await hasOverlappingLease({
        propertyId: selectedPropertyId,
        unitId,
        startDate,
        endDate,
      });
      if (overlaps) {
        Alert.alert(
          'Space Unavailable',
          'This space already has a pending or active lease for overlapping dates. Terminate or renew the existing agreement instead.',
        );
        return;
      }

      // Insert pending lease — becomes active when rent payment is verified.
      const { error: leaseError } = await supabase.from('leases').insert({
        property_id: selectedPropertyId,
        unit_id: unitId,
        tenant_id: selectedUser.id,
        owner_id: ownerId,
        start_date: startDate,
        end_date: endDate,
        rent_amount: rentNum,
        status: 'pending',
      });

      if (leaseError) throw leaseError;

      await promoteClientToTenant(selectedUser.id, selectedUser.role);

      log({
        action: 'create',
        entityType: 'lease',
        entityId: selectedUser.id,
        description: `Allocated pending lease to ${selectedUser.full_name}`,
      });
      Alert.alert(
        'Lease Assigned',
        `Pending lease created for ${selectedUser.full_name}. It becomes active after rent is paid and verified.`,
      );
      setLeaseModalVisible(false);
      setSelectedPropertyId('');
      setSelectedUnitId('');
      setUnits([]);
      setStartDate(todayISODate());
      setEndDate('');
      setRentAmount('');
      await invalidateUsers();
      await fetchAvailableProperties();
    } catch (err: any) {
      console.error('Create lease error:', err);
      Alert.alert('Error', leaseAssignErrorMessage(err));
    } finally {
      setSubmittingLease(false);
    }
  };

  const openLeaseModal = async (user: Profile) => {
    setSelectedUser(user);
    setSelectedPropertyId('');
    setSelectedUnitId('');
    setUnits([]);
    setStartDate(todayISODate());
    setEndDate('');
    setRentAmount('');
    setLeaseModalVisible(true);
    await fetchAvailableProperties();
  };

  const selectProperty = async (property: Property) => {
    setSelectedPropertyId(property.id);
    setSelectedUnitId('');
    setRentAmount(property.price.toString());
    try {
      setLoadingUnits(true);
      const assignable = await fetchAssignableUnits(property.id);
      setUnits(assignable);
    } catch (err) {
      console.error('Fetch assignable units error:', err);
      setUnits([]);
    } finally {
      setLoadingUnits(false);
    }
  };

  const openRoleModal = (user: Profile) => {
    setSelectedUser(user);
    setSelectedRole(user.role as any);
    setRoleModalVisible(true);
  };

  return (
    <View style={styles.container}>
      {loading && users.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          {...LIST_PERF}
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
                  <Text style={styles.roleBtnText}>Role</Text>
                </TouchableOpacity>

                {(item.role === 'client' || item.role === 'tenant') && (
                  <TouchableOpacity
                    style={[styles.btn, styles.leaseBtn]}
                    onPress={() => openLeaseModal(item)}
                  >
                    <Calendar size={14} color="#0F172A" style={styles.btnIcon} />
                    <Text style={styles.leaseBtnText}>Lease</Text>
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
          onRefresh={async () => {
            await Promise.all([refresh(), loadLandlordRequests()]);
          }}
          refreshing={refreshing || loadingLandlordRequests}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            landlordRequests.length === 0 ? null : (
              <View style={styles.requestsPanel}>
                <Text style={styles.requestsTitle}>Landlord account requests</Text>
                <Text style={styles.requestsLead}>
                  Create an account for each requester, then share login credentials with them.
                </Text>
                {landlordRequests.map((request) => (
                  <View key={request.id} style={styles.requestCard}>
                    <Text style={styles.requestName}>{request.full_name}</Text>
                    <Text style={styles.requestMeta}>{request.email}</Text>
                    <Text style={styles.requestMeta}>{request.phone}</Text>
                    {request.note ? (
                      <Text style={styles.requestNote}>{request.note}</Text>
                    ) : null}
                    <View style={styles.requestActions}>
                      <TouchableOpacity
                        style={[styles.btn, styles.leaseBtn]}
                        onPress={() => openCreateFromLandlordRequest(request)}
                      >
                        <UserPlus size={14} color="#0F172A" style={styles.btnIcon} />
                        <Text style={styles.leaseBtnText}>Create account</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.deleteUserBtn]}
                        onPress={() => handleDismissLandlordRequest(request)}
                      >
                        <Text style={styles.deleteUserBtnText}>Dismiss</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator color="#38BDF8" />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyCentered}>
              <Users size={48} color="#94A3B8" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No users in the registry yet.</Text>
            </View>
          }
        />
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            setFulfillingRequestId(null);
            setProvisionMode('account');
            setInviteModalVisible(true);
          }}
        >
          <UserPlus size={24} color="#0F172A" />
        </TouchableOpacity>
        </>
      )}

      {/* Invite / Create User Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={inviteModalVisible}
        onRequestClose={() => {
          setInviteModalVisible(false);
          setFulfillingRequestId(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {provisionMode === 'invite' ? 'Invite User' : 'Create User Account'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setInviteModalVisible(false);
                  setFulfillingRequestId(null);
                }}
              >
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, provisionMode === 'account' && styles.modeBtnActive]}
                  onPress={() => setProvisionMode('account')}
                >
                  <Text style={[styles.modeBtnText, provisionMode === 'account' && styles.modeBtnTextActive]}>
                    Create Account
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, provisionMode === 'invite' && styles.modeBtnActive]}
                  onPress={() => setProvisionMode('invite')}
                >
                  <Text style={[styles.modeBtnText, provisionMode === 'invite' && styles.modeBtnTextActive]}>
                    Invite Email
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.inviteNote}>
                <Mail size={16} color="#38BDF8" style={{ marginRight: 8 }} />
                <Text style={styles.inviteNoteText}>
                  {provisionMode === 'invite'
                    ? 'Save an invite so this email can self-register. Required when public sign-up is disabled. Their role is applied on sign-up.'
                    : 'Create a complete login account. The user signs in with the email and password you set here, and can change their password later from their profile.'}
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
                <Text style={styles.label}>{provisionMode === 'invite' ? 'Full Name (optional)' : 'Username'}</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Jane Doe"
                  placeholderTextColor="#999"
                  value={newUsername}
                  onChangeText={setNewUsername}
                  autoCapitalize="words"
                />
              </View>

              {provisionMode === 'account' ? (
                <>
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
                </>
              ) : null}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Assign Role</Text>
                <View style={styles.roleSelectionRow}>
                  {(
                    provisionMode === 'invite'
                      ? (['client', 'tenant', 'finance', 'admin'] as InviteRole[])
                      : (['client', 'tenant', 'landlord', 'finance', 'admin'] as InviteRole[])
                  ).map((r) => (
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
                  <Text style={styles.submitBtnText}>
                    {provisionMode === 'invite' ? 'Save Invite' : 'Create Account'}
                  </Text>
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
                  {['client', 'tenant', 'landlord', 'finance', 'admin'].map((r) => (
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
                        ? 'No rental listings found. Go to Manage Properties and add a rental listing with a landlord assigned.'
                        : 'No available rental properties. Assign a landlord, free a vacant unit, or terminate an existing lease.'}
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
                          onPress={() => selectProperty(p)}
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

                {selectedPropertyId ? (
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      {units.length > 0 || loadingUnits ? 'Select Unit' : 'Unit'}
                    </Text>
                    {loadingUnits ? (
                      <ActivityIndicator color="#38BDF8" style={styles.propertyLoader} />
                    ) : units.length === 0 ? (
                      <Text style={styles.modalSubText}>
                        Whole-property lease (no vacant units listed for this property).
                      </Text>
                    ) : (
                      <View style={styles.propertyGrid}>
                        {units.map((u) => (
                          <TouchableOpacity
                            key={u.id}
                            style={[
                              styles.propertyBtn,
                              selectedUnitId === u.id && styles.propertyBtnActive,
                            ]}
                            onPress={() => {
                              setSelectedUnitId(u.id);
                              setRentAmount(u.rent_amount.toString());
                            }}
                          >
                            <Text
                              style={[
                                styles.propertyText,
                                selectedUnitId === u.id && styles.propertyTextActive,
                              ]}
                            >
                              Unit {u.unit_number} (KES {u.rent_amount})
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ) : null}

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
                    <Text style={styles.submitBtnText}>Assign Pending Lease</Text>
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
  requestsPanel: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  requestsTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  requestsLead: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  requestCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  requestName: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  requestMeta: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  requestNote: {
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  requestActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  loadingMore: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 40,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
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
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14,
  },
  btn: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  roleBtn: {
    borderColor: '#38BDF8',
    borderWidth: 1,
  },
  roleBtnText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 13,
  },
  leaseBtn: {
    backgroundColor: '#38BDF8',
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
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: '#38BDF8',
    borderColor: '#38BDF8',
  },
  modeBtnText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 13,
  },
  modeBtnTextActive: {
    color: '#0F172A',
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
