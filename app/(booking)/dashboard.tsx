import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { notifyUser } from '../../lib/notifications';
import { Calendar, User, Clock, Check, X, FileText, CalendarClock } from 'lucide-react-native';

interface Booking {
  id: string;
  client_id: string;
  booking_date: string;
  type: 'viewing' | 'reservation';
  status: 'pending' | 'approved' | 'declined' | 'completed' | 'cancelled';
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

  // Reschedule modal state
  const [rescheduling, setRescheduling] = useState<Booking | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [savingReschedule, setSavingReschedule] = useState(false);

  // Fetch pending bookings with joined property and client profile data
  const fetchPendingBookings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          client_id,
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

  // Update booking status (approve or decline)
  const updateBookingStatus = async (booking: Booking, nextStatus: 'approved' | 'declined') => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: nextStatus })
        .eq('id', booking.id);

      if (error) throw error;

      await notifyClient(
        booking,
        nextStatus === 'approved' ? 'Booking Approved' : 'Booking Declined',
        `Your ${booking.type} request for "${booking.properties?.title}" has been ${nextStatus}.`
      );

      Alert.alert('Success', `Booking request has been ${nextStatus}.`);
      // Update local state to remove processed item
      setBookings((prev) => prev.filter((b) => b.id !== booking.id));
    } catch (err: any) {
      console.error('Update booking status error:', err);
      Alert.alert('Error', 'Failed to update booking status.');
    }
  };

  const cancelBooking = (booking: Booking) => {
    Alert.alert('Cancel Booking', 'Cancel this booking request? The client will be notified.', [
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
              `Your ${booking.type} request for "${booking.properties?.title}" has been cancelled. Contact us to rebook.`
            );

            setBookings((prev) => prev.filter((b) => b.id !== booking.id));
          } catch (err: any) {
            console.error('Cancel booking error:', err);
            Alert.alert('Error', 'Failed to cancel booking.');
          }
        },
      },
    ]);
  };

  const openReschedule = (booking: Booking) => {
    const d = new Date(booking.booking_date);
    setNewDate(d.toISOString().slice(0, 10));
    setNewTime(d.toISOString().slice(11, 16));
    setRescheduling(booking);
  };

  const submitReschedule = async () => {
    if (!rescheduling) return;

    const parsed = new Date(`${newDate.trim()}T${newTime.trim()}:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate.trim()) || !/^\d{2}:\d{2}$/.test(newTime.trim()) || isNaN(parsed.getTime())) {
      Alert.alert('Validation Error', 'Enter a valid date (YYYY-MM-DD) and time (HH:MM).');
      return;
    }

    try {
      setSavingReschedule(true);
      const { error } = await supabase
        .from('bookings')
        .update({ booking_date: parsed.toISOString() })
        .eq('id', rescheduling.id);

      if (error) throw error;

      await notifyClient(
        rescheduling,
        'Booking Rescheduled',
        `Your ${rescheduling.type} for "${rescheduling.properties?.title}" has been moved to ${newDate.trim()} at ${newTime.trim()}.`
      );

      Alert.alert('Success', 'Booking rescheduled and client notified.');
      setRescheduling(null);
      fetchPendingBookings();
    } catch (err: any) {
      console.error('Reschedule booking error:', err);
      Alert.alert('Error', 'Failed to reschedule booking.');
    } finally {
      setSavingReschedule(false);
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
                  onPress={() => updateBookingStatus(item, 'declined')}
                >
                  <X size={16} color="#EF4444" style={styles.btnIcon} />
                  <Text style={styles.declineText}>Decline</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => updateBookingStatus(item, 'approved')}
                >
                  <Check size={16} color="#0F172A" style={styles.btnIcon} />
                  <Text style={styles.approveText}>Approve</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.secondaryActionContainer}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rescheduleBtn]}
                  onPress={() => openReschedule(item)}
                >
                  <CalendarClock size={16} color="#EAB308" style={styles.btnIcon} />
                  <Text style={styles.rescheduleText}>Reschedule</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.cancelBtn]}
                  onPress={() => cancelBooking(item)}
                >
                  <X size={16} color="#94A3B8" style={styles.btnIcon} />
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchPendingBookings}
          refreshing={loading}
        />
      )}

      {/* Reschedule Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={!!rescheduling}
        onRequestClose={() => setRescheduling(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reschedule Booking</Text>
              <TouchableOpacity onPress={() => setRescheduling(null)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {rescheduling?.properties?.title} — {rescheduling?.profiles?.full_name}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>New Date (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 2026-07-15"
                placeholderTextColor="#999"
                value={newDate}
                onChangeText={setNewDate}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>New Time (HH:MM)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 14:30"
                placeholderTextColor="#999"
                value={newTime}
                onChangeText={setNewTime}
              />
            </View>

            <TouchableOpacity
              style={styles.submitBtn}
              onPress={submitReschedule}
              disabled={savingReschedule}
            >
              {savingReschedule ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text style={styles.submitBtnText}>Save & Notify Client</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  secondaryActionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
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
  rescheduleBtn: {
    borderColor: '#EAB308',
    borderWidth: 1,
    marginRight: 8,
  },
  cancelBtn: {
    borderColor: '#475569',
    borderWidth: 1,
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
  rescheduleText: {
    color: '#EAB308',
    fontWeight: 'bold',
  },
  cancelText: {
    color: '#94A3B8',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 14,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  modalSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 15,
  },
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  submitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
