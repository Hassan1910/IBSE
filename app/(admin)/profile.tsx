import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import { LogOut, User, Mail, Phone } from 'lucide-react-native';
import { useRole } from '../../hooks/useRole';
import { useSignOutPrompt } from '../../hooks/useSignOutPrompt';
import { adminTheme } from '../../constants/adminTheme';
import ChangePasswordCard from '../../components/ChangePasswordCard';

export default function AdminProfile() {
  const { user } = useUser();
  const { role } = useRole();
  const { requestSignOut, signOutModal } = useSignOutPrompt();
  const accountLabel = role === 'finance' ? 'IBSA Finance Account' : 'IBSA Administrator Account';

  return (
    <View style={styles.container}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <User size={40} color={adminTheme.colors.onAccent} />
        </View>
        <Text style={styles.name}>{user?.fullName || 'Admin User'}</Text>
        <Text style={styles.roleText}>{accountLabel}</Text>
      </View>

      <View style={styles.infoList}>
        <View style={styles.infoItem}>
          <Mail size={20} color={adminTheme.colors.accent} style={styles.icon} />
          <View>
            <Text style={styles.infoLabel}>Email Address</Text>
            <Text style={styles.infoVal}>{user?.primaryEmailAddress?.emailAddress}</Text>
          </View>
        </View>

        <View style={[styles.infoItem, styles.infoItemLast]}>
          <Phone size={20} color={adminTheme.colors.accent} style={styles.icon} />
          <View>
            <Text style={styles.infoLabel}>Phone Number</Text>
            <Text style={styles.infoVal}>{user?.primaryPhoneNumber?.phoneNumber || 'Synced on profile'}</Text>
          </View>
        </View>
      </View>

      <ChangePasswordCard />

      <TouchableOpacity style={styles.logoutBtn} onPress={requestSignOut}>
        <LogOut size={20} color={adminTheme.colors.danger} style={styles.logoutIcon} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
      {signOutModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: adminTheme.colors.bg,
    padding: adminTheme.spacing.xl,
    justifyContent: 'center',
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: adminTheme.colors.surface,
    borderRadius: adminTheme.radius.lg,
    padding: adminTheme.spacing.xl,
    borderColor: adminTheme.colors.border,
    borderWidth: 1,
    marginBottom: adminTheme.spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: adminTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: adminTheme.spacing.lg,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: adminTheme.colors.text,
  },
  roleText: {
    fontSize: 14,
    color: adminTheme.colors.accent,
    fontWeight: '500',
    marginTop: 4,
  },
  infoList: {
    backgroundColor: adminTheme.colors.surface,
    borderRadius: adminTheme.radius.md,
    padding: adminTheme.spacing.lg,
    borderColor: adminTheme.colors.border,
    borderWidth: 1,
    marginBottom: adminTheme.spacing.xl,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: adminTheme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: adminTheme.colors.border,
  },
  infoItemLast: {
    borderBottomWidth: 0,
  },
  icon: {
    marginRight: adminTheme.spacing.lg,
  },
  infoLabel: {
    fontSize: 12,
    color: adminTheme.colors.textMuted,
  },
  infoVal: {
    fontSize: 15,
    color: adminTheme.colors.text,
    fontWeight: '500',
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    backgroundColor: adminTheme.colors.dangerMuted,
    borderColor: adminTheme.colors.danger,
    borderWidth: 1,
    borderRadius: adminTheme.radius.sm,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutIcon: {
    marginRight: adminTheme.spacing.sm,
  },
  logoutText: {
    color: adminTheme.colors.danger,
    fontWeight: '700',
    fontSize: 16,
  },
});
