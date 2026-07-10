import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useUser, useAuth } from '@clerk/clerk-expo';
import { LogOut, User, Mail, Phone } from 'lucide-react-native';
import ChangePasswordCard from '../../components/ChangePasswordCard';

export default function BookingProfile() {
  const { user } = useUser();
  const { signOut } = useAuth();

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <User size={40} color="#0F172A" />
        </View>
        <Text style={styles.name}>{user?.fullName || 'Booking Staff'}</Text>
        <Text style={styles.roleText}>IBSA Booking Staff Account</Text>
      </View>

      <View style={styles.infoList}>
        <View style={styles.infoItem}>
          <Mail size={20} color="#38BDF8" style={styles.icon} />
          <View>
            <Text style={styles.infoLabel}>Email Address</Text>
            <Text style={styles.infoVal}>{user?.primaryEmailAddress?.emailAddress}</Text>
          </View>
        </View>

        <View style={styles.infoItem}>
          <Phone size={20} color="#38BDF8" style={styles.icon} />
          <View>
            <Text style={styles.infoLabel}>Phone Number</Text>
            <Text style={styles.infoVal}>{user?.primaryPhoneNumber?.phoneNumber || 'Synced on profile'}</Text>
          </View>
        </View>
      </View>

      <ChangePasswordCard />

      <TouchableOpacity style={styles.logoutBtn} onPress={handleSignOut}>
        <LogOut size={20} color="#EF4444" style={styles.logoutIcon} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 24,
    justifyContent: 'center',
  },
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
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  roleText: {
    fontSize: 14,
    color: '#38BDF8',
    fontWeight: '500',
    marginTop: 4,
  },
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
  icon: {
    marginRight: 16,
  },
  infoLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  infoVal: {
    fontSize: 15,
    color: '#F8FAFC',
    fontWeight: '500',
    marginTop: 2,
  },
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
  logoutIcon: {
    marginRight: 8,
  },
  logoutText: {
    color: '#EF4444',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
