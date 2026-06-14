import React, { useState, useEffect } from 'react';
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
import { Calendar, User, Clock, Check, X, FileText } from 'lucide-react-native';

interface Booking {
  id: string;
  booking_date: string;
  type: 'viewing' | 'reservation';
  status: 'pending' | 'approved' | 'declined';
  notes: string;
  properties: {
    title: string;
    location: string;
  };
  profiles: {
    full_name: string;
    email: string;
    phone: string;
  };
}

export default function BookingDashboard() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch pending bookings with joined property and client profile data
  const fetchPendingBookings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          booking_date,
          type,
          status,
          notes,
          properties ( title, location ),
          profiles ( full_name, email, phone )
        `)
        .eq('status', 'pending')
        .order('booking_date', { ascending: true });

      if (error) throw error;
      setBookings((data as any) || []);
    } catch (err: any) {
      console.error('Fetch pending bookings error:', err);
      Alert.alert('Error', 'Failed to load booking requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingBookings();
  }, []);

  // Update booking status (approve or decline)
  const updateBookingStatus = async (id: string, nextStatus: 'approved' | 'declined') => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: nextStatus })
        .eq('id', id);

      if (error) throw error;

      Alert.alert('Success', `Booking request has been ${nextStatus}.`);
      // Update local state to remove processed item
      setBookings((prev) => prev.filter((b) => b.id !== id));
    } catch (err: any) {
      console.error('Update booking status error:', err);
      Alert.alert('Error', 'Failed to update booking status.');
    }
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

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : bookings.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No pending viewing or reservation requests.</Text>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.propTitle}>{item.properties?.title}</Text>
                <View style={[
                  styles.badge,
                  item.type === 'reservation' ? styles.badgeReservation : styles.badgeViewing
                ]}>
                  <Text style={styles.badgeText}>{item.type.toUpperCase()}</Text>
                </View>
              </View>

              <Text style={styles.location}>{item.properties?.location}</Text>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <User size={16} color="#38BDF8" style={styles.icon} />
                <View>
                  <Text style={styles.infoTextBold}>{item.profiles?.full_name}</Text>
                  <Text style={styles.infoTextSub}>{item.profiles?.email} | {item.profiles?.phone || 'No phone'}</Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Calendar size={16} color="#38BDF8" style={styles.icon} />
                <Text style={styles.infoText}>{formatDate(item.booking_date)}</Text>
              </View>

              <View style={styles.infoRow}>
                <Clock size={16} color="#38BDF8" style={styles.icon} />
                <Text style={styles.infoText}>{formatTime(item.booking_date)}</Text>
              </View>

              {item.notes && (
                <View style={styles.noteBox}>
                  <FileText size={14} color="#94A3B8" style={styles.noteIcon} />
                  <Text style={styles.noteText}>{item.notes}</Text>
                </View>
              )}

              <View style={styles.actionContainer}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.declineBtn]}
                  onPress={() => updateBookingStatus(item.id, 'declined')}
                >
                  <X size={16} color="#EF4444" style={styles.btnIcon} />
                  <Text style={styles.declineText}>Decline</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => updateBookingStatus(item.id, 'approved')}
                >
                  <Check size={16} color="#0F172A" style={styles.btnIcon} />
                  <Text style={styles.approveText}>Approve</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchPendingBookings}
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
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  propTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  location: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeViewing: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
  },
  badgeReservation: {
    backgroundColor: 'rgba(234, 179, 8, 0.2)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#38BDF8',
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  icon: {
    marginRight: 10,
  },
  infoText: {
    color: '#F8FAFC',
    fontSize: 14,
  },
  infoTextBold: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  infoTextSub: {
    color: '#94A3B8',
    fontSize: 12,
  },
  noteBox: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 6,
    padding: 10,
    marginTop: 6,
    marginBottom: 14,
  },
  noteIcon: {
    marginRight: 6,
    marginTop: 2,
  },
  noteText: {
    color: '#94A3B8',
    fontSize: 13,
    flex: 1,
  },
  actionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  declineBtn: {
    borderColor: '#EF4444',
    borderWidth: 1,
    marginRight: 8,
  },
  approveBtn: {
    backgroundColor: '#38BDF8',
    marginLeft: 8,
  },
  btnIcon: {
    marginRight: 6,
  },
  declineText: {
    color: '#EF4444',
    fontWeight: 'bold',
  },
  approveText: {
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
