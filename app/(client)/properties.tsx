import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { MapPin, Info, Tag, Calendar, X } from 'lucide-react-native';

interface Property {
  id: string;
  title: string;
  description: string;
  type: 'rental' | 'sale';
  category: 'residential' | 'commercial' | 'land';
  price: number;
  location: string;
  status: 'available' | 'rented' | 'sold';
  image_urls: string[];
}

const CATEGORIES = ['All', 'Residential', 'Commercial', 'Land'];

export default function PropertiesScreen() {
  const { user } = useUser();
  const [properties, setProperties] = useState<Property[]>([]);
  const [filteredProperties, setFilteredProperties] = useState<Property[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);

  // Booking Modal States
  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [bookingType, setBookingType] = useState<'viewing' | 'reservation'>('viewing');
  const [notes, setNotes] = useState('');
  const [submittingBooking, setSubmittingBooking] = useState(false);

  // Fetch properties from Supabase
  const fetchProperties = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('status', 'available')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProperties(data || []);
      setFilteredProperties(data || []);
    } catch (err: any) {
      console.error('Fetch properties error:', err);
      Alert.alert('Error', 'Failed to load property listings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  // Filter properties when category changes
  useEffect(() => {
    if (selectedCategory === 'All') {
      setFilteredProperties(properties);
    } else {
      setFilteredProperties(
        properties.filter(
          (p) => p.category.toLowerCase() === selectedCategory.toLowerCase()
        )
      );
    }
  }, [selectedCategory, properties]);

  // Handle Booking submission
  const handleBookingSubmit = async () => {
    if (!user || !selectedProperty) return;

    if (!bookingDate || !bookingTime) {
      Alert.alert('Validation Error', 'Please enter both a date (YYYY-MM-DD) and a time.');
      return;
    }

    try {
      setSubmittingBooking(true);
      const fullDateTime = `${bookingDate}T${bookingTime}:00Z`;

      const { error } = await supabase.from('bookings').insert({
        property_id: selectedProperty.id,
        client_id: user.id,
        booking_date: fullDateTime,
        type: bookingType,
        notes: notes || '',
        status: 'pending',
      });

      if (error) throw error;

      Alert.alert('Success 🎉', `Your ${bookingType} request has been submitted! Our booking officers will review it shortly.`);
      setBookingModalVisible(false);
      // Reset form fields
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

  const openBookingModal = (property: Property) => {
    setSelectedProperty(property);
    setBookingModalVisible(true);
  };

  const formatPrice = (price: number, type: string) => {
    const formatted = new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0,
    }).format(price);
    return type === 'rental' ? `${formatted}/month` : formatted;
  };

  return (
    <View style={styles.container}>
      {/* Categories Tab Bar */}
      <View style={styles.tabContainer}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[
              styles.tabBtn,
              selectedCategory === cat && styles.tabBtnActive,
            ]}
            onPress={() => setSelectedCategory(cat)}
          >
            <Text
              style={[
                styles.tabText,
                selectedCategory === cat && styles.tabTextActive,
              ]}
            >
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : filteredProperties.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No available properties found in this category.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProperties}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Image
                source={{
                  uri: item.image_urls?.[0] || 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=80',
                }}
                style={styles.cardImage}
              />
              <View style={styles.cardBody}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeText}>{item.type.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <MapPin size={16} color="#38BDF8" style={styles.infoIcon} />
                  <Text style={styles.infoText}>{item.location}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Tag size={16} color="#38BDF8" style={styles.infoIcon} />
                  <Text style={styles.infoText}>{item.category.toUpperCase()}</Text>
                </View>

                <Text style={styles.price}>{formatPrice(item.price, item.type)}</Text>
                <Text style={styles.description} numberOfLines={2}>
                  {item.description}
                </Text>

                <View style={styles.cardFooter}>
                  <TouchableOpacity
                    style={styles.bookBtn}
                    onPress={() => openBookingModal(item)}
                  >
                    <Calendar size={16} color="#0F172A" style={styles.btnIcon} />
                    <Text style={styles.bookBtnText}>Book Viewing</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchProperties}
          refreshing={loading}
        />
      )}

      {/* Booking Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={bookingModalVisible}
        onRequestClose={() => setBookingModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Book Viewing / Reservation</Text>
              <TouchableOpacity onPress={() => setBookingModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedProperty && (
              <View style={styles.modalBody}>
                <Text style={styles.modalPropTitle}>{selectedProperty.title}</Text>
                <Text style={styles.modalPropLoc}>{selectedProperty.location}</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Booking Type</Text>
                  <View style={styles.toggleContainer}>
                    <TouchableOpacity
                      style={[
                        styles.toggleBtn,
                        bookingType === 'viewing' && styles.toggleBtnActive,
                      ]}
                      onPress={() => setBookingType('viewing')}
                    >
                      <Text
                        style={[
                          styles.toggleBtnText,
                          bookingType === 'viewing' && styles.toggleBtnTextActive,
                        ]}
                      >
                        Viewing (Free)
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.toggleBtn,
                        bookingType === 'reservation' && styles.toggleBtnActive,
                      ]}
                      onPress={() => setBookingType('reservation')}
                    >
                      <Text
                        style={[
                          styles.toggleBtnText,
                          bookingType === 'reservation' && styles.toggleBtnTextActive,
                        ]}
                      >
                        Reservation
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Select Date</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#999"
                    value={bookingDate}
                    onChangeText={setBookingDate}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Select Time</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="HH:MM (e.g. 14:00)"
                    placeholderTextColor="#999"
                    value={bookingTime}
                    onChangeText={setBookingTime}
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
                    <Text style={styles.modalSubmitBtnText}>Submit Booking Request</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
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
  tabContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    justifyContent: 'space-around',
  },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  tabBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  tabText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 13,
  },
  tabTextActive: {
    color: '#38BDF8',
  },
  listContainer: {
    padding: 16,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardImage: {
    width: '100%',
    height: 180,
  },
  cardBody: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  typeBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  typeText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: 'bold',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  infoIcon: {
    marginRight: 6,
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  price: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginVertical: 10,
  },
  description: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14,
  },
  bookBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnIcon: {
    marginRight: 8,
  },
  bookBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 15,
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
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: '#38BDF8',
  },
  toggleBtnText: {
    color: '#94A3B8',
    fontWeight: '600',
  },
  toggleBtnTextActive: {
    color: '#0F172A',
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
