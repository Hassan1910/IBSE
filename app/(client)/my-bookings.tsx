import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { Calendar, Clock, HelpCircle, CheckCircle, XCircle, CheckCheck } from 'lucide-react-native';
import { queryKeys } from '../../hooks/queries/keys';
import { LIST_PERF, PAGE_SIZE } from '../../lib/queryClient';

interface Booking {
  id: string;
  booking_date: string;
  type: 'viewing';
  status: 'pending' | 'approved' | 'declined' | 'completed' | 'cancelled';
  notes: string;
  properties: {
    title: string;
    location: string;
  };
}

async function fetchClientBookings(userId: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      `
      id,
      booking_date,
      type,
      status,
      notes,
      properties ( title, location )
    `
    )
    .eq('client_id', userId)
    .order('booking_date', { ascending: false })
    .limit(PAGE_SIZE.queues);
  if (error) throw error;
  return (data as any as Booking[]) || [];
}

export default function MyBookingsScreen() {
  const { user } = useUser();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id: focusId } = useLocalSearchParams<{ id?: string }>();
  const userId = user?.id || '';
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const bookingsQuery = useQuery({
    queryKey: queryKeys.clientBookings(userId),
    queryFn: () => fetchClientBookings(userId),
    enabled: !!userId,
  });

  const bookings = bookingsQuery.data || [];
  const loading = bookingsQuery.isLoading && !bookingsQuery.data;
  const refreshing = bookingsQuery.isRefetching && !bookingsQuery.isLoading;

  useEffect(() => {
    if (bookingsQuery.isError) {
      console.error('Fetch bookings error:', bookingsQuery.error);
      Alert.alert('Error', 'Failed to retrieve your bookings.');
    }
  }, [bookingsQuery.isError, bookingsQuery.error]);

  useEffect(() => {
    if (!focusId || loading) return;
    if (bookings.some((b) => b.id === focusId)) {
      setHighlightedId(focusId);
      router.setParams({ id: undefined });
      const timer = setTimeout(() => setHighlightedId(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [focusId, loading, bookings, router]);

  const handleCancel = (booking: Booking) => {
    Alert.alert(
      'Cancel Viewing',
      `Cancel your viewing request for ${booking.properties?.title || 'this property'}?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Request',
          style: 'destructive',
          onPress: async () => {
            try {
              setCancellingId(booking.id);
              const { error } = await supabase
                .from('bookings')
                .update({ status: 'cancelled' })
                .eq('id', booking.id)
                .eq('status', 'pending');

              if (error) throw error;

              await queryClient.invalidateQueries({ queryKey: queryKeys.clientBookings(userId) });
              Alert.alert('Cancelled', 'Your viewing request has been cancelled.');
            } catch (err: any) {
              console.error('Cancel booking error:', err);
              Alert.alert('Error', err.message || 'Failed to cancel booking.');
            } finally {
              setCancellingId(null);
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-KE', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-KE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderStatus = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <View style={[styles.statusBadge, styles.statusApproved]}>
            <CheckCircle size={14} color="#10B981" style={styles.badgeIcon} />
            <Text style={[styles.statusText, styles.textApproved]}>Approved</Text>
          </View>
        );
      case 'declined':
        return (
          <View style={[styles.statusBadge, styles.statusDeclined]}>
            <XCircle size={14} color="#EF4444" style={styles.badgeIcon} />
            <Text style={[styles.statusText, styles.textDeclined]}>Declined</Text>
          </View>
        );
      case 'completed':
        return (
          <View style={[styles.statusBadge, styles.statusCompleted]}>
            <CheckCheck size={14} color="#38BDF8" style={styles.badgeIcon} />
            <Text style={[styles.statusText, styles.textCompleted]}>Completed</Text>
          </View>
        );
      case 'cancelled':
        return (
          <View style={[styles.statusBadge, styles.statusCancelled]}>
            <XCircle size={14} color="#94A3B8" style={styles.badgeIcon} />
            <Text style={[styles.statusText, styles.textCancelled]}>Cancelled</Text>
          </View>
        );
      default:
        return (
          <View style={[styles.statusBadge, styles.statusPending]}>
            <HelpCircle size={14} color="#EAB308" style={styles.badgeIcon} />
            <Text style={[styles.statusText, styles.textPending]}>Pending</Text>
          </View>
        );
    }
  };

  return (
    <View style={styles.container}>
      {loading && bookings.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={[styles.card, highlightedId === item.id && styles.highlightedCard]}>
              <View style={styles.cardHeader}>
                <Text style={styles.propTitle}>{item.properties?.title}</Text>
                {renderStatus(item.status)}
              </View>

              <Text style={styles.location}>{item.properties?.location}</Text>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <Calendar size={16} color="#38BDF8" style={styles.icon} />
                <Text style={styles.infoText}>{formatDate(item.booking_date)}</Text>
              </View>

              <View style={styles.infoRow}>
                <Clock size={16} color="#38BDF8" style={styles.icon} />
                <Text style={styles.infoText}>{formatTime(item.booking_date)}</Text>
              </View>

              <View style={styles.infoRow}>
                <HelpCircle size={16} color="#38BDF8" style={styles.icon} />
                <Text style={styles.infoText}>
                  Type: <Text style={styles.boldText}>{item.type.toUpperCase()}</Text>
                </Text>
              </View>

              {item.notes ? (
                <Text style={styles.noteText}>Notes: "{item.notes}"</Text>
              ) : null}

              {item.status === 'pending' ? (
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => handleCancel(item)}
                  disabled={cancellingId === item.id}
                >
                  {cancellingId === item.id ? (
                    <ActivityIndicator color="#EF4444" size="small" />
                  ) : (
                    <Text style={styles.cancelBtnText}>Cancel Request</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          )}
          contentContainerStyle={[styles.listContainer, bookings.length === 0 && styles.emptyList]}
          onRefresh={() => bookingsQuery.refetch()}
          refreshing={refreshing}
          initialNumToRender={LIST_PERF.initialNumToRender}
          windowSize={LIST_PERF.windowSize}
          maxToRenderPerBatch={LIST_PERF.maxToRenderPerBatch}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>You haven't requested any property viewings yet.</Text>
            </View>
          }
        />
      )}
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
  emptyList: {
    flexGrow: 1,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  highlightedCard: {
    borderColor: '#38BDF8',
    borderWidth: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  propTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  location: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    marginRight: 10,
  },
  infoText: {
    color: '#F8FAFC',
    fontSize: 14,
  },
  boldText: {
    fontWeight: 'bold',
  },
  noteText: {
    color: '#94A3B8',
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 6,
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 6,
  },
  cancelBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  cancelBtnText: {
    color: '#EF4444',
    fontWeight: 'bold',
    fontSize: 14,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusPending: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
  },
  statusApproved: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  statusDeclined: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  statusCompleted: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  statusCancelled: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
  },
  badgeIcon: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  textPending: {
    color: '#EAB308',
  },
  textApproved: {
    color: '#10B981',
  },
  textDeclined: {
    color: '#EF4444',
  },
  textCompleted: {
    color: '#38BDF8',
  },
  textCancelled: {
    color: '#94A3B8',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 15,
    textAlign: 'center',
  },
});
