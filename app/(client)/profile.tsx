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
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAudit } from '../../hooks/useAudit';
import { pickImages, uploadImage } from '../../lib/storage';
import ChangePasswordCard from '../../components/ChangePasswordCard';
import { Camera, Edit2, LogOut, Mail, Phone, User, X } from 'lucide-react-native';

interface ClientProfileRow {
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
}

export default function ClientProfile() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const router = useRouter();
  const { log } = useAudit();
  const [profile, setProfile] = useState<ClientProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editVisible, setEditVisible] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, email, phone, avatar_url')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      setProfile((data as ClientProfileRow) ?? null);
    } catch (err) {
      console.error('Fetch client profile error:', err);
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
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
        })
        .eq('id', user.id);
      if (error) throw error;
      await log({
        action: 'update',
        entityType: 'profile',
        entityId: user.id,
        description: 'Client updated profile details.',
      });
      Alert.alert('Success', 'Profile updated.');
      setEditVisible(false);
      fetchProfile();
    } catch (err) {
      console.error('Update client profile error:', err);
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
      const avatarUrl = await uploadImage('avatars', `${user.id}/avatar.jpg`, picked[0]);
      const { error } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', user.id);
      if (error) throw error;
      await log({
        action: 'update',
        entityType: 'profile',
        entityId: user.id,
        description: 'Client updated profile avatar.',
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.profileCard}>
        <TouchableOpacity style={styles.avatarWrap} onPress={handleChangeAvatar} disabled={uploadingAvatar}>
          {profile?.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={styles.avatarImg}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.avatar}>
              <User size={40} color="#0F172A" />
            </View>
          )}
          <View style={styles.cameraBadge}>
            {uploadingAvatar ? <ActivityIndicator size="small" color="#0F172A" /> : <Camera size={14} color="#0F172A" />}
          </View>
        </TouchableOpacity>
        <Text style={styles.name}>{profile?.full_name || user?.fullName || 'Client User'}</Text>
        <Text style={styles.roleText}>IBSA Client Account</Text>
        <TouchableOpacity style={styles.editBtn} onPress={openEdit}>
          <Edit2 size={16} color="#38BDF8" />
          <Text style={styles.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoList}>
        <View style={styles.infoItem}>
          <Mail size={20} color="#38BDF8" style={styles.icon} />
          <View style={styles.infoTextWrap}>
            <Text style={styles.infoLabel}>Email Address</Text>
            <Text style={styles.infoVal}>{profile?.email || user?.primaryEmailAddress?.emailAddress}</Text>
          </View>
        </View>
        <View style={[styles.infoItem, styles.infoItemLast]}>
          <Phone size={20} color="#38BDF8" style={styles.icon} />
          <View style={styles.infoTextWrap}>
            <Text style={styles.infoLabel}>Phone Number</Text>
            <Text style={styles.infoVal}>{profile?.phone || 'Not set'}</Text>
          </View>
        </View>
      </View>

      <ChangePasswordCard />

      <TouchableOpacity
        style={styles.helpBtn}
        onPress={() => router.push('/(client)/help')}
      >
        <Text style={styles.helpBtnText}>Help & Guides</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleSignOut}>
        <LogOut size={20} color="#EF4444" style={styles.logoutIcon} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)}>
                <X size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Full name"
              placeholderTextColor="#64748B"
              value={fullName}
              onChangeText={setFullName}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Phone number"
              placeholderTextColor="#64748B"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' },
  content: { padding: 24, paddingBottom: 40 },
  profileCard: {
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 24,
  },
  avatarWrap: { marginBottom: 16 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: 80, height: 80, borderRadius: 40 },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 20, fontWeight: 'bold', color: '#F8FAFC' },
  roleText: { fontSize: 14, color: '#38BDF8', fontWeight: '500', marginTop: 4 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  editBtnText: { color: '#38BDF8', fontWeight: '600' },
  infoList: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 24,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  infoItemLast: { borderBottomWidth: 0 },
  infoTextWrap: { flex: 1 },
  icon: { marginRight: 16 },
  infoLabel: { fontSize: 12, color: '#94A3B8' },
  infoVal: { fontSize: 15, color: '#F8FAFC', fontWeight: '500', marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  helpBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  helpBtnText: { color: '#38BDF8', fontWeight: '700', fontSize: 15 },
  logoutIcon: { marginRight: 8 },
  logoutText: { color: '#EF4444', fontWeight: 'bold', fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '700' },
  modalInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  saveBtnText: { color: '#0F172A', fontWeight: '700' },
});
