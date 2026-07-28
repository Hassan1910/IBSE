import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import {
  AppNotification,
  fetchNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../lib/notifications';
import { getNotificationRoute, type NotificationRole } from '../lib/notificationRoutes';
import { subscribeNotificationListSync } from '../lib/notificationMoneySync';
import { BellRing, CheckCheck } from 'lucide-react-native';

interface NotificationsScreenProps {
  role: NotificationRole;
}

export default function NotificationsScreen({ role }: NotificationsScreenProps) {
  const router = useRouter();
  const { user } = useUser();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      setLoadError(false);
      const { data, error } = await fetchNotifications(user.id);
      if (error) throw error;
      setItems((data as AppNotification[]) || []);
    } catch (err) {
      console.error('Load notifications error:', err);
      setLoadError(true);
      Alert.alert('Error', 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (!user?.id) return;
    return subscribeNotificationListSync(user.id, () => {
      void loadNotifications();
    });
  }, [user?.id, loadNotifications]);

  const openNotification = async (item: AppNotification) => {
    if (!item.read_at) {
      const { error } = await markNotificationAsRead(item.id);
      if (!error) {
        setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
      }
    }

    const target = getNotificationRoute(role, item);
    if (target) {
      router.navigate(target as any);
      return;
    }
    if (item.type === 'account_approval' || item.entity_type === 'profile') {
      Alert.alert('Account approval', 'Only admins can approve new accounts. Open Users & Leases from an admin account.');
    }
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    try {
      setMarkingAll(true);
      const { error } = await markAllNotificationsAsRead(user.id);
      if (error) throw error;
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    } catch (err) {
      console.error('Mark all notifications read error:', err);
      Alert.alert('Error', 'Failed to mark all notifications as read.');
    } finally {
      setMarkingAll(false);
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-KE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.markAllBtn}
        onPress={markAllRead}
        disabled={markingAll || items.length === 0}
      >
        {markingAll ? (
          <ActivityIndicator color="#0F172A" />
        ) : (
          <>
            <CheckCheck size={15} color="#0F172A" style={{ marginRight: 6 }} />
            <Text style={styles.markAllText}>Mark all as read</Text>
          </>
        )}
      </TouchableOpacity>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        onRefresh={loadNotifications}
        refreshing={loading}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.read_at && styles.unreadCard]}
            onPress={() => openNotification(item)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.title}>{item.title}</Text>
              {!item.read_at ? <View style={styles.unreadDot} /> : null}
            </View>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.meta}>{formatDate(item.created_at)}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.centered}>
            <BellRing size={44} color="#94A3B8" style={{ marginBottom: 10 }} />
            <Text style={styles.emptyText}>
              {loadError ? 'Could not load notifications.' : 'You have no notifications yet.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#94A3B8', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  markAllBtn: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  markAllText: { color: '#0F172A', fontWeight: 'bold', fontSize: 13 },
  card: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  unreadCard: { borderColor: '#38BDF8' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#F8FAFC', fontWeight: 'bold', fontSize: 14, flex: 1, marginRight: 8 },
  body: { color: '#CBD5E1', fontSize: 13, lineHeight: 20, marginTop: 6 },
  meta: { color: '#64748B', fontSize: 11, marginTop: 10 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#38BDF8' },
});
