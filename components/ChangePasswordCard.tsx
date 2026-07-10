import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import { KeyRound, X } from 'lucide-react-native';
import { useAudit } from '../hooks/useAudit';

/**
 * Self-service change-password card + modal. Reuses Clerk's
 * `user.updatePassword` so any signed-in user can rotate the password an admin
 * originally set for them.
 */
export default function ChangePasswordCard() {
  const { user } = useUser();
  const { log } = useAudit();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

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
      setSaving(true);
      await user?.updatePassword({ currentPassword, newPassword });
      await log({
        action: 'update',
        entityType: 'profile',
        entityId: user?.id,
        description: 'User changed account password.',
      });
      Alert.alert('Success', 'Your password has been changed.');
      setVisible(false);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      console.error('Change password error:', err);
      Alert.alert('Error', err.errors?.[0]?.message || err.message || 'Failed to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TouchableOpacity style={styles.actionCard} onPress={() => setVisible(true)}>
        <KeyRound size={18} color="#38BDF8" style={styles.actionIcon} />
        <Text style={styles.actionText}>Change Password</Text>
      </TouchableOpacity>

      <Modal animationType="slide" transparent visible={visible} onRequestClose={() => setVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
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
                autoCapitalize="none"
              />
              <TextInput
                style={styles.modalInput}
                placeholder="New password"
                placeholderTextColor="#999"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.submitBtn} onPress={handleChangePassword} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>Update Password</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderColor: '#334155',
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  actionIcon: { marginRight: 8 },
  actionText: { color: '#F8FAFC', fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.8)' },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 12,
  },
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
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 6,
  },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 15 },
});
