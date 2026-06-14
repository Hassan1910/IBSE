import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { Calendar, Clock, HelpCircle, CheckCircle, XCircle } from 'lucide-react-native';

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
}

export default function MyBookingsScreen() {
  const { user } = useUser();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMyBookings = async () => {
    if (!user) return;

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
          properties ( title, location )
        `)
        .eq('client_id', user.id)
        .order('booking_date', { ascending: false });

      if (error) throw error;
      setBookings((data as any) || []);
    } catch (err: any) {
      console.error('Fetch bookings error:', err);
      Alert.alert('Error', 'Failed to retrieve your bookings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyBookings();
  }, [user]);

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
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : bookings.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>You haven't requested any property viewings yet.</Text>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
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
            </View>
          )}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchMyBookings}
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
