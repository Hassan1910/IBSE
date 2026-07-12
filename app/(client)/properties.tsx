import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { notifyAdmins } from '../../lib/notifications';
import { useUser } from '@clerk/clerk-expo';
import { Calendar, X } from 'lucide-react-native';
import DatePickerModal from '../../components/DatePickerModal';
import PropertyBrowseList, {
  BrowseProperty,
} from '../../components/PropertyBrowseList';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** Build an ISO timestamp from local calendar date + wall-clock time. */
function localDateTimeToIso(dateStr: string, timeStr: string): string | null {
  if (!DATE_RE.test(dateStr) || !TIME_RE.test(timeStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (hh > 23 || mm > 59) return null;
  const local = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  // Reject dates that overflow (e.g. 2026-02-31 → March)
  if (
    local.getFullYear() !== y ||
    local.getMonth() !== m - 1 ||
    local.getDate() !== d
  ) {
    return null;
  }
  return local.toISOString();
}

export default function PropertiesScreen() {
  const { user } = useUser();

  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<BrowseProperty | null>(null);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [notes, setNotes] = useState('');
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  const handleBookingSubmit = async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in again to submit a viewing request.');
      return;
    }
    if (!selectedProperty) return;

    if (!bookingDate || !bookingTime) {
      Alert.alert('Validation Error', 'Please select a date and enter a time (HH:MM).');
      return;
    }

    const fullDateTime = localDateTimeToIso(bookingDate.trim(), bookingTime.trim());
    if (!fullDateTime) {
      Alert.alert(
        'Validation Error',
        'Use a valid date as YYYY-MM-DD and time as HH:MM (24-hour), e.g. 2026-07-15 and 14:30.'
      );
      return;
    }

    try {
      setSubmittingBooking(true);

      const { data: created, error } = await supabase
        .from('bookings')
        .insert({
          property_id: selectedProperty.id,
          client_id: user.id,
          booking_date: fullDateTime,
          type: 'viewing',
          notes: notes || '',
          status: 'pending',
        })
        .select('id')
        .single();

      if (error) throw error;

      try {
        await notifyAdmins({
          type: 'booking_update',
          title: 'New Viewing Request',
          body: `${user.fullName || 'A client'} requested a viewing for ${selectedProperty.title}.`,
          entityType: 'booking',
          entityId: created?.id,
        });
      } catch (notifyErr) {
        console.error('Notify admins (booking) error:', notifyErr);
      }

      Alert.alert('Success', 'Your viewing request has been submitted! Our team will review it shortly.');
      setBookingModalVisible(false);
      setBookingDate('');
      setBookingTime('');
      setNotes('');
    } catch (err: any) {
      console.error('Booking submission error:', err);
      Alert.alert('Error', err.message || 'Failed to submit booking request.');
    } finally {
      setSubmittingBooking(false);
    }
  };

  const openBookingModal = (property: BrowseProperty) => {
    setSelectedProperty(property);
    setBookingModalVisible(true);
  };

  return (
    <View style={styles.container}>
      <PropertyBrowseList onAction={openBookingModal} />

      <Modal
        animationType="slide"
        transparent={true}
        visible={bookingModalVisible}
        onRequestClose={() => setBookingModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Book Viewing</Text>
              <TouchableOpacity onPress={() => setBookingModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedProperty && (
              <View style={styles.modalBody}>
                <Text style={styles.modalPropTitle}>{selectedProperty.title}</Text>
                <Text style={styles.modalPropLoc}>{selectedProperty.location}</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Select Date</Text>
                  <TouchableOpacity
                    style={styles.datePickerBtn}
                    onPress={() => setDatePickerVisible(true)}
                  >
                    <Text
                      style={[
                        styles.datePickerText,
                        !bookingDate && styles.datePickerPlaceholder,
                      ]}
                    >
                      {bookingDate || 'Tap to select a date'}
                    </Text>
                    <Calendar size={18} color="#38BDF8" />
                  </TouchableOpacity>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Select Time</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="HH:MM (e.g. 14:00)"
                    placeholderTextColor="#999"
                    value={bookingTime}
                    onChangeText={setBookingTime}
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Additional Notes (Optional)</Text>
                  <TextInput
                    style={[styles.modalInput, styles.textArea]}
                    placeholder="Tell us any details or requests..."
                    placeholderTextColor="#999"
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    numberOfLines={3}
                  />
                </View>

                <TouchableOpacity
                  style={styles.modalSubmitBtn}
                  onPress={handleBookingSubmit}
                  disabled={submittingBooking}
                >
                  {submittingBooking ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>Submit Viewing Request</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <DatePickerModal
        visible={datePickerVisible}
        onClose={() => setDatePickerVisible(false)}
        value={bookingDate}
        onChange={setBookingDate}
        title="Select Viewing Date"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
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
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 14,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  modalBody: {
    marginTop: 6,
  },
  modalPropTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#38BDF8',
  },
  modalPropLoc: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
  inputGroup: {
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 15,
  },
  datePickerBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickerText: {
    color: '#F8FAFC',
    fontSize: 15,
  },
  datePickerPlaceholder: {
    color: '#999',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  modalSubmitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 4,
  },
  modalSubmitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
