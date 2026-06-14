import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { Plus, X, MapPin, Tag, Landmark, Wrench } from 'lucide-react-native';

interface Property {
  id: string;
  title: string;
  description: string;
  type: 'rental' | 'sale';
  category: 'residential' | 'commercial' | 'land';
  price: number;
  location: string;
  status: 'available' | 'rented' | 'sold';
}

export default function AdminPropertiesScreen() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  // New Property Form States
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'rental' | 'sale'>('rental');
  const [category, setCategory] = useState<'residential' | 'commercial' | 'land'>('residential');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchProperties = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProperties(data || []);
    } catch (err: any) {
      console.error('Fetch properties error:', err);
      Alert.alert('Error', 'Failed to load property inventory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim() || !price || !location.trim()) {
      Alert.alert('Validation Error', 'Please fill in all fields.');
      return;
    }

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid positive price.');
      return;
    }

    try {
      setSubmitting(true);
      const { error } = await supabase.from('properties').insert({
        title: title.trim(),
        description: description.trim(),
        type,
        category,
        price: numPrice,
        location: location.trim(),
        status: 'available',
      });

      if (error) throw error;

      Alert.alert('Success 🎉', 'New property listed successfully.');
      setModalVisible(false);
      // Reset form
      setTitle('');
      setDescription('');
      setPrice('');
      setLocation('');
      fetchProperties();
    } catch (err: any) {
      console.error('Add property error:', err);
      Alert.alert('Error', 'Failed to add new property listing.');
    } finally {
      setSubmitting(false);
    }
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
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          <FlatList
            data={properties}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <View style={[
                    styles.statusBadge,
                    item.status === 'available' ? styles.statusAvail : styles.statusRented
                  ]}>
                    <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <MapPin size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>{item.location}</Text>
                </View>

                <View style={styles.infoRow}>
                  <Tag size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>
                    {item.category.toUpperCase()} • {item.type.toUpperCase()}
                  </Text>
                </View>

                <Text style={styles.price}>{formatPrice(item.price, item.type)}</Text>
                <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
              </View>
            )}
            contentContainerStyle={styles.listContainer}
            onRefresh={fetchProperties}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <Landmark size={48} color="#94A3B8" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>No property listings exist yet.</Text>
              </View>
            }
          />

          <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
            <Plus size={24} color="#0F172A" />
          </TouchableOpacity>
        </>
      )}

      {/* Add Property Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Property Listing</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Property Title</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 2-Bedroom Apartment Wing B"
                  placeholderTextColor="#999"
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={[styles.modalInput, styles.textArea]}
                  placeholder="Describe property features, access, water supply details..."
                  placeholderTextColor="#999"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              {/* Type toggle */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Listing Type</Text>
                <View style={styles.toggleContainer}>
                  {(['rental', 'sale'] as const).map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.toggleBtn,
                        type === t && styles.toggleBtnActive,
                      ]}
                      onPress={() => setType(t)}
                    >
                      <Text
                        style={[
                          styles.toggleBtnText,
                          type === t && styles.toggleBtnTextActive,
                        ]}
                      >
                        {t.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Category toggle */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.toggleContainer}>
                  {(['residential', 'commercial', 'land'] as const).map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.toggleBtn,
                        category === c && styles.toggleBtnActive,
                      ]}
                      onPress={() => setCategory(c)}
                    >
                      <Text
                        style={[
                          styles.toggleBtnText,
                          category === c && styles.toggleBtnTextActive,
                        ]}
                      >
                        {c.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Price (KES)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 15000"
                  placeholderTextColor="#999"
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Location</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Marsabit Town, Gari Road"
                  placeholderTextColor="#999"
                  value={location}
                  onChangeText={setLocation}
                />
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>List Property</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusAvail: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  statusRented: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  icon: {
    marginRight: 8,
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  price: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginVertical: 10,
  },
  desc: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCentered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    marginTop: 60,
  },
  emptyIcon: {
    marginBottom: 12,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
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
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  modalBody: {
    paddingBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
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
  textArea: {
    height: 90,
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
    fontSize: 12,
  },
  toggleBtnTextActive: {
    color: '#0F172A',
    fontWeight: 'bold',
  },
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  submitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
