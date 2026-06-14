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
import { Calendar, User, Clock, CheckCircle } from 'lucide-react-native';

interface Booking {
  id: string;
  booking_date: string;
  type: 'viewing' | 'reservation';
  status: 'approved';
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

export default function BookingSchedule() {
  const [schedule, setSchedule] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSchedule = async () => {
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
          profiles ( full_name, phone )
        `)
        .eq('status', 'approved')
        .order('booking_date', { ascending: true });

      if (error) throw error;
      setSchedule((data as any) || []);
    } catch (err: any) {
      console.error('Fetch schedule error:', err);
      Alert.alert('Error', 'Failed to load booking schedule.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, []);

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

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : schedule.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No approved viewings or bookings scheduled.</Text>
        </View>
      ) : (
        <FlatList
          data={schedule}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <CheckCircle size={20} color="#10B981" />
                <Text style={styles.statusText}>Approved & Scheduled</Text>
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
    color: '#10B981',
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
