import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { useSignOutPrompt } from '../../hooks/useSignOutPrompt';
import { useAudit } from '../../hooks/useAudit';
import { pickImages, uploadImage } from '../../lib/storage';
import { Camera, Edit2, IdCard, KeyRound, LogOut, Mail, Phone, ShieldCheck, User, Users, X } from 'lucide-react-native';

interface TenantProfileRow {
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  id_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}

export default function TenantProfile() {
  const { user } = useUser();
  const { log } = useAudit();
  const { requestSignOut, signOutModal } = useSignOutPrompt();
  const [profile, setProfile] = useState<TenantProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editVisible, setEditVisible] = useState(false);
  const [pwVisible, setPwVisible] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, email, phone, avatar_url, id_number, emergency_contact_name, emergency_contact_phone')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setProfile((data as TenantProfileRow) ?? null);
    } catch (err) {
      console.error('Fetch tenant profile error:', err);
      Alert.alert('Error', 'Failed to load your profile details.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const openEdit = () => {
    setFullName(profile?.full_name || user?.fullName || '');
    setPhone(profile?.phone || '');
    setIdNumber(profile?.id_number || '');
    setEmergencyName(profile?.emergency_contact_name || '');
    setEmergencyPhone(profile?.emergency_contact_phone || '');
    setEditVisible(true);
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    if (!fullName.trim()) {
      Alert.alert('Validation Error', 'Please enter your full name.');
      return;
    }

    try {
      setSavingProfile(true);
      const patch = {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        id_number: idNumber.trim() || null,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
      };

      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
      if (error) throw error;

      // Keep Clerk display name in sync with the app profile.
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || undefined;
      try {
        await user.update({ firstName, lastName });
      } catch (clerkErr) {
        console.error('Sync Clerk name error:', clerkErr);
      }

      await log({
        action: 'update',
        entityType: 'profile',
        entityId: user.id,
        description: 'Tenant updated profile details.',
      });

      Alert.alert('Success', 'Profile updated.');
      setEditVisible(false);
      fetchProfile();
    } catch (err) {
      console.error('Update tenant profile error:', err);
      Alert.alert('Error', 'Failed to update your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangeAvatar = async () => {
    if (!user?.id) return;
    try {
      setUploadingAvatar(true);
      const picked = await pickImages(false);
      if (!picked.length) return;

      const filePath = `${user.id}/avatar.jpg`;
      const avatarUrl = await uploadImage('avatars', filePath, picked[0]);
      const { error } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', user.id);
      if (error) throw error;

      await log({
        action: 'update',
        entityType: 'profile',
        entityId: user.id,
        description: 'Tenant updated profile avatar.',
      });

      Alert.alert('Success', 'Profile photo updated.');
      fetchProfile();
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      Alert.alert('Error', err.message || 'Failed to update profile photo.');
    } finally {
      setUploadingAvatar(false);
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
      await log({
        action: 'update',
        entityType: 'profile',
        entityId: user?.id,
        description: 'Tenant changed account password.',
      });
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
        <TouchableOpacity style={styles.avatar} onPress={handleChangeAvatar} disabled={uploadingAvatar}>
          {profile?.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={styles.avatarImage}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <User size={40} color="#0F172A" />
          )}
          <View style={styles.avatarOverlay}>
            {uploadingAvatar ? <ActivityIndicator size="small" color="#F8FAFC" /> : <Camera size={14} color="#F8FAFC" />}
          </View>
        </TouchableOpacity>
        <Text style={styles.name}>{profile?.full_name || user?.fullName || 'Tenant'}</Text>
        <Text style={styles.roleText}>IBSA Tenant Account</Text>
      </View>

      <View style={styles.infoList}>
        <View style={styles.infoItem}>
          <Mail size={18} color="#38BDF8" style={styles.icon} />
          <View style={styles.flexItem}>
            <Text style={styles.infoLabel}>Email Address</Text>
            <Text style={styles.infoVal}>{profile?.email || user?.primaryEmailAddress?.emailAddress}</Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <Phone size={18} color="#38BDF8" style={styles.icon} />
          <View style={styles.flexItem}>
            <Text style={styles.infoLabel}>Phone Number</Text>
            <Text style={styles.infoVal}>{profile?.phone || 'Not set'}</Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <IdCard size={18} color="#38BDF8" style={styles.icon} />
          <View style={styles.flexItem}>
            <Text style={styles.infoLabel}>Identification Number</Text>
            <Text style={styles.infoVal}>{profile?.id_number || 'Not set'}</Text>
          </View>
        </View>
        <View style={[styles.infoItem, styles.infoItemLast]}>
          <Users size={18} color="#38BDF8" style={styles.icon} />
          <View style={styles.flexItem}>
            <Text style={styles.infoLabel}>Emergency Contact</Text>
            <Text style={styles.infoVal}>
              {profile?.emergency_contact_name
                ? `${profile.emergency_contact_name}${profile.emergency_contact_phone ? ` (${profile.emergency_contact_phone})` : ''}`
                : 'Not set'}
            </Text>
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
        <Text style={styles.securityNoteText}>Keep your credentials private and update your details regularly.</Text>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={requestSignOut}>
        <LogOut size={20} color="#EF4444" style={styles.actionIcon} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
      {signOutModal}

      <Modal animationType="slide" transparent visible={editVisible} onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Update Profile</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)}>
                <X size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <TextInput style={styles.modalInput} placeholder="Full name" placeholderTextColor="#999" value={fullName} onChangeText={setFullName} />
              <TextInput style={styles.modalInput} placeholder="Phone number" placeholderTextColor="#999" value={phone} onChangeText={setPhone} />
              <TextInput style={styles.modalInput} placeholder="ID number" placeholderTextColor="#999" value={idNumber} onChangeText={setIdNumber} />
              <TextInput style={styles.modalInput} placeholder="Emergency contact name" placeholderTextColor="#999" value={emergencyName} onChangeText={setEmergencyName} />
              <TextInput style={styles.modalInput} placeholder="Emergency contact phone" placeholderTextColor="#999" value={emergencyPhone} onChangeText={setEmergencyPhone} />
              <TouchableOpacity style={styles.submitBtn} onPress={handleSaveProfile} disabled={savingProfile}>
                {savingProfile ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.submitBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={pwVisible} onRequestClose={() => setPwVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setPwVisible(false)}>
                <X size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <TextInput
                style={styles.modalInput}
                placeholder="Current password"
                placeholderTextColor="#999"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
              />
              <TextInput
                style={styles.modalInput}
                placeholder="New password"
                placeholderTextColor="#999"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
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
  content: { padding: 20, paddingBottom: 30 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' },
  profileCard: {
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 16,
  },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#38BDF8', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarImage: { width: 88, height: 88, borderRadius: 44 },
  avatarOverlay: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  name: { fontSize: 20, fontWeight: 'bold', color: '#F8FAFC' },
  roleText: { marginTop: 4, color: '#38BDF8', fontWeight: '500' },
  infoList: { backgroundColor: '#1E293B', borderRadius: 12, borderColor: '#334155', borderWidth: 1, paddingHorizontal: 14, marginBottom: 16 },
  infoItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  infoItemLast: { borderBottomWidth: 0 },
  icon: { marginRight: 12 },
  flexItem: { flex: 1 },
  infoLabel: { color: '#94A3B8', fontSize: 12 },
  infoVal: { color: '#F8FAFC', marginTop: 2, fontSize: 14, fontWeight: '500' },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderColor: '#334155',
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  actionIcon: { marginRight: 8 },
  actionText: { color: '#F8FAFC', fontSize: 14, fontWeight: '600' },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  securityNoteText: { color: '#A7F3D0', fontSize: 12, flex: 1, lineHeight: 18 },
  logoutBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
  },
  logoutText: { color: '#EF4444', fontWeight: 'bold', fontSize: 15 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.8)' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#334155', paddingBottom: 12 },
  modalTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: 'bold' },
  modalBody: { paddingBottom: 8 },
  modalInput: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderColor: '#334155',
    borderWidth: 1,
    color: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, marginTop: 6 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 15 },
});
