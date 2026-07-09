import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useUser, useAuth } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { LogOut, User, Mail, Phone, Edit2, KeyRound, X, ShieldCheck } from 'lucide-react-native';

interface ProfileRow {
  full_name: string;
  email: string;
  phone: string | null;
}

export default function LandlordProfile() {
  const { user } = useUser();
  const { signOut } = useAuth();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [editVisible, setEditVisible] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [pwVisible, setPwVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, email, phone')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      setProfile(data);
    } catch (err) {
      console.error('Fetch profile error:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const openEdit = () => {
    setFullName(profile?.full_name || '');
    setPhone(profile?.phone || '');
    setEditVisible(true);
  };

  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      Alert.alert('Validation Error', 'Please enter your full name.');
      return;
    }
    if (!user?.id) return;
    try {
      setSavingProfile(true);
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), phone: phone.trim() || null })
        .eq('id', user.id);
      if (error) throw error;
      Alert.alert('Success', 'Profile updated.');
      setEditVisible(false);
      fetchProfile();
    } catch (err) {
      console.error('Update profile error:', err);
      Alert.alert('Error', 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Validation Error', 'Please fill in both password fields.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Validation Error', 'New password must be at least 8 characters.');
      return;
    }
    try {
      setSavingPw(true);
      await user?.updatePassword({ currentPassword, newPassword });
      Alert.alert('Success', 'Your password has been changed.');
      setPwVisible(false);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      console.error('Change password error:', err);
      Alert.alert('Error', err.errors?.[0]?.message || err.message || 'Failed to change password.');
    } finally {
      setSavingPw(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <User size={40} color="#0F172A" />
        </View>
        <Text style={styles.name}>{profile?.full_name || user?.fullName || 'Landlord'}</Text>
        <Text style={styles.roleText}>IBSA Landlord Account</Text>
      </View>

      <View style={styles.infoList}>
        <View style={styles.infoItem}>
          <Mail size={20} color="#38BDF8" style={styles.icon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Email Address</Text>
            <Text style={styles.infoVal}>{profile?.email || user?.primaryEmailAddress?.emailAddress}</Text>
          </View>
        </View>

        <View style={[styles.infoItem, styles.infoItemLast]}>
          <Phone size={20} color="#38BDF8" style={styles.icon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Phone Number</Text>
            <Text style={styles.infoVal}>{profile?.phone || 'Not set'}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.actionCard} onPress={openEdit}>
        <Edit2 size={18} color="#38BDF8" style={styles.actionIcon} />
        <Text style={styles.actionText}>Update Personal Details</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionCard} onPress={() => setPwVisible(true)}>
        <KeyRound size={18} color="#38BDF8" style={styles.actionIcon} />
        <Text style={styles.actionText}>Change Password</Text>
      </TouchableOpacity>

      <View style={styles.securityNote}>
        <ShieldCheck size={16} color="#10B981" style={styles.actionIcon} />
        <Text style={styles.securityNoteText}>
          Your account is protected by secure authentication. Keep your password private.
        </Text>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleSignOut}>
        <LogOut size={20} color="#EF4444" style={styles.actionIcon} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      {/* Edit Profile Modal */}
      <Modal animationType="slide" transparent visible={editVisible} onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Update Details</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Your full name"
                  placeholderTextColor="#999"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. +254 700000000"
                  placeholderTextColor="#999"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>
              <TouchableOpacity style={styles.submitBtn} onPress={handleSaveProfile} disabled={savingProfile}>
                {savingProfile ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.submitBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal animationType="slide" transparent visible={pwVisible} onRequestClose={() => setPwVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setPwVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Current Password</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="••••••••"
                  placeholderTextColor="#999"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Password</Text>
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
              <TouchableOpacity style={styles.submitBtn} onPress={handleChangePassword} disabled={savingPw}>
                {savingPw ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.submitBtnText}>Update Password</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 24 },
  centered: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  profileCard: {
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  name: { fontSize: 20, fontWeight: 'bold', color: '#F8FAFC' },
  roleText: { fontSize: 14, color: '#38BDF8', fontWeight: '500', marginTop: 4 },
  infoList: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  infoItemLast: { borderBottomWidth: 0 },
  icon: { marginRight: 16 },
  infoLabel: { fontSize: 12, color: '#94A3B8' },
  infoVal: { fontSize: 15, color: '#F8FAFC', fontWeight: '500', marginTop: 2 },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 12,
  },
  actionIcon: { marginRight: 12 },
  actionText: { color: '#F8FAFC', fontSize: 15, fontWeight: '500' },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    marginTop: 4,
  },
  securityNoteText: { color: '#94A3B8', fontSize: 12, lineHeight: 18, flex: 1 },
  logoutBtn: {
    flexDirection: 'row',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: { color: '#EF4444', fontWeight: 'bold', fontSize: 16 },
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
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
