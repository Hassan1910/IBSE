import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { notifyUser } from '../../lib/notifications';
import { Calendar, User, Clock, CheckCircle, XCircle, HelpCircle, CheckCheck } from 'lucide-react-native';

type BookingStatus = 'pending' | 'approved' | 'completed' | 'cancelled' | 'declined';

interface Booking {
  id: string;
  client_id: string;
  booking_date: string;
  type: 'viewing' | 'reservation';
  status: BookingStatus;
  notes: string;
  properties: {
    title: string;
    location: string;
  };
  profiles: {
    full_name: string;
    phone: string;
  };
}

const FILTERS: { key: BookingStatus | 'all'; label: string }[] = [
  { key: 'approved', label: 'Approved' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const STATUS_META: Record<BookingStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#EAB308' },
  approved: { label: 'Approved & Scheduled', color: '#10B981' },
  completed: { label: 'Completed', color: '#38BDF8' },
  cancelled: { label: 'Cancelled', color: '#94A3B8' },
  declined: { label: 'Declined', color: '#EF4444' },
};

export default function BookingSchedule() {
  const [schedule, setSchedule] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<BookingStatus | 'all'>('approved');

  const fetchSchedule = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('bookings')
        .select(`
          id,
          client_id,
          booking_date,
          type,
          status,
          notes,
          properties ( title, location ),
          profiles ( full_name, phone )
        `)
        .order('booking_date', { ascending: true });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setSchedule((data as any) || []);
    } catch (err: any) {
      console.error('Fetch schedule error:', err);
      Alert.alert('Error', 'Failed to load booking schedule.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const notifyClient = async (booking: Booking, title: string, body: string) => {
    try {
      await notifyUser({
        userId: booking.client_id,
        type: 'booking_update',
        title,
        body,
        entityType: 'booking',
        entityId: booking.id,
      });
    } catch (err) {
      console.warn('Notify client error:', err);
    }
  };

  const markCompleted = async (booking: Booking) => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'completed' })
        .eq('id', booking.id);

      if (error) throw error;

      await notifyClient(
        booking,
        'Booking Completed',
        `Your ${booking.type} of "${booking.properties?.title}" has been marked completed. Thank you for visiting!`
      );

      setSchedule((prev) =>
        filter === 'all'
          ? prev.map((b) => (b.id === booking.id ? { ...b, status: 'completed' } : b))
          : prev.filter((b) => b.id !== booking.id)
      );
    } catch (err: any) {
      console.error('Mark completed error:', err);
      Alert.alert('Error', 'Failed to mark booking as completed.');
    }
  };

  const cancelBooking = (booking: Booking) => {
    Alert.alert('Cancel Booking', 'Cancel this scheduled booking? The client will be notified.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Booking',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('bookings')
              .update({ status: 'cancelled' })
              .eq('id', booking.id);

            if (error) throw error;

            await notifyClient(
              booking,
              'Booking Cancelled',
              `Your scheduled ${booking.type} of "${booking.properties?.title}" has been cancelled. Contact us to rebook.`
            );

            setSchedule((prev) =>
              filter === 'all'
                ? prev.map((b) => (b.id === booking.id ? { ...b, status: 'cancelled' } : b))
                : prev.filter((b) => b.id !== booking.id)
            );
          } catch (err: any) {
            console.error('Cancel booking error:', err);
            Alert.alert('Error', 'Failed to cancel booking.');
          }
        },
      },
    ]);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-KE', {
      weekday: 'long',
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

  const renderStatusIcon = (status: BookingStatus) => {
    const color = STATUS_META[status].color;
    switch (status) {
      case 'approved':
        return <CheckCircle size={20} color={color} />;
      case 'completed':
        return <CheckCheck size={20} color={color} />;
      case 'cancelled':
      case 'declined':
        return <XCircle size={20} color={color} />;
      default:
        return <HelpCircle size={20} color={color} />;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : schedule.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No {filter === 'all' ? '' : `${filter} `}viewings or bookings found.
          </Text>
        </View>
      ) : (
        <FlatList
          data={schedule}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                {renderStatusIcon(item.status)}
                <Text style={[styles.statusText, { color: STATUS_META[item.status].color }]}>
                  {STATUS_META[item.status].label}
                </Text>
              </View>

              <Text style={styles.propTitle}>{item.properties?.title}</Text>
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
                <User size={16} color="#38BDF8" style={styles.icon} />
                <Text style={styles.infoText}>
                  Client: <Text style={styles.boldText}>{item.profiles?.full_name}</Text> ({item.profiles?.phone || 'No phone'})
                </Text>
              </View>

              {item.status === 'approved' && (
                <View style={styles.actionContainer}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.cancelBtn]}
                    onPress={() => cancelBooking(item)}
                  >
                    <XCircle size={16} color="#94A3B8" style={styles.btnIcon} />
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, styles.completeBtn]}
                    onPress={() => markCompleted(item)}
                  >
                    <CheckCheck size={16} color="#0F172A" style={styles.btnIcon} />
                    <Text style={styles.completeText}>Mark Completed</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchSchedule}
          refreshing={loading}
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
  },
  filterChipActive: {
    backgroundColor: '#38BDF8',
    borderColor: '#38BDF8',
  },
  filterText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#0F172A',
  },
  listContainer: {
    padding: 16,
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
    alignItems: 'center',
    marginBottom: 10,
  },
  statusText: {
    fontWeight: 'bold',
    fontSize: 13,
    marginLeft: 6,
  },
  propTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
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
  actionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  cancelBtn: {
    borderColor: '#475569',
    borderWidth: 1,
    marginRight: 8,
  },
  completeBtn: {
    backgroundColor: '#38BDF8',
    marginLeft: 8,
  },
  btnIcon: {
    marginRight: 6,
  },
  cancelText: {
    color: '#94A3B8',
    fontWeight: 'bold',
  },
  completeText: {
    color: '#0F172A',
    fontWeight: 'bold',
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
