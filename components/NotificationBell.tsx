import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useNotifications } from '../hooks/useNotifications';

interface NotificationBellProps {
  href: string;
}

/** Bell + unread badge that navigates to the role's notifications screen. */
export default function NotificationBell({ href }: NotificationBellProps) {
  const router = useRouter();
  const { unreadCount } = useNotifications();

  return (
    <TouchableOpacity style={styles.bellBtn} onPress={() => router.push(href as any)}>
      <Bell size={18} color="#38BDF8" />
      {unreadCount > 0 ? (
        <View style={styles.badgeDot}>
          <Text style={styles.badgeDotText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeDotText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
});
