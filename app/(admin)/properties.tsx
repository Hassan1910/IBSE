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
  Image,
} from 'react-native';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { pickImages, uploadImage, type PickedImage } from '../../lib/storage';
import { Plus, X, MapPin, Tag, Landmark, Edit2, Trash2, Camera, User } from 'lucide-react-native';

interface Property {
  id: string;
  title: string;
  description: string;
  type: 'rental' | 'sale';
  category: 'residential' | 'commercial' | 'land';
  price: number;
  location: string;
  status: 'available' | 'rented' | 'sold';
  image_urls: string[] | null;
  owner_id?: string | null;
  profiles?: { full_name: string } | null;
}

export default function AdminPropertiesScreen() {
  const { user } = useUser();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [landlords, setLandlords] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [selectedLandlordId, setSelectedLandlordId] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'rental' | 'sale'>('rental');
  const [category, setCategory] = useState<'residential' | 'commercial' | 'land'>('residential');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [selectedImages, setSelectedImages] = useState<PickedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setPrice('');
    setLocation('');
    setSelectedImages([]);
    setType('rental');
    setCategory('residential');
    setSelectedLandlordId(null);
  };

  const handleEdit = (property: Property) => {
    setEditingId(property.id);
    setTitle(property.title);
    setDescription(property.description);
    setType(property.type);
    setCategory(property.category);
    setPrice(property.price.toString());
    setLocation(property.location);
    setSelectedImages((property.image_urls || []).map((uri) => ({ uri })));
    setSelectedLandlordId(property.owner_id || null);
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete Property', 'Are you sure you want to delete this property? This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('properties').delete().eq('id', id);
            if (error) throw error;
            Alert.alert('Success', 'Property deleted.');
            setProperties((prev) => prev.filter((p) => p.id !== id));
          } catch (err) {
            console.error('Delete property error:', err);
            Alert.alert('Error', 'Failed to delete property.');
          }
        },
      },
    ]);
  };

  const handlePickImages = async () => {
    try {
      const picked = await pickImages(true);
      if (picked.length > 0) {
        setSelectedImages((prev) => [...prev, ...picked].slice(0, 5));
      }
    } catch (err: any) {
      Alert.alert('Permission Required', err.message || 'Could not access photo library.');
    }
  };

  const handleRemoveImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const fetchLandlords = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'landlord')
        .order('full_name', { ascending: true });
      if (error) throw error;
      setLandlords(data || []);
    } catch (err) {
      console.error('Fetch landlords error:', err);
    }
  };

  const fetchProperties = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('properties')
        .select('*, profiles:owner_id ( full_name )')
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
    fetchLandlords();
  }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim() || !price || !location.trim()) {
      Alert.alert('Validation Error', 'Please fill in all required fields.');
      return;
    }

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice <= 0) {
      Alert.alert('Validation Error', 'Please enter a valid positive price.');
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'Could not determine your account. Please sign in again.');
      return;
    }

    if (type === 'rental' && !selectedLandlordId) {
      Alert.alert('Validation Error', 'Assign a landlord before saving a rental property.');
      return;
    }

    try {
      setSubmitting(true);

      // Upload any new local images (URIs starting with file:// or content://)
      const uploadedUrls: string[] = [];
      for (const img of selectedImages) {
        if (img.uri.startsWith('http://') || img.uri.startsWith('https://')) {
          uploadedUrls.push(img.uri);
        } else {
          const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
          const path = `${user.id}/${filename}`;
          const publicUrl = await uploadImage('property-images', path, img);
          uploadedUrls.push(publicUrl);
        }
      }

      if (editingId) {
        const { error } = await supabase
          .from('properties')
          .update({
            title: title.trim(),
            description: description.trim(),
            type,
            category,
            price: numPrice,
            location: location.trim(),
            image_urls: uploadedUrls,
            owner_id: selectedLandlordId,
          })
          .eq('id', editingId);

        if (error) throw error;
        Alert.alert('Success', 'Property updated successfully.');
      } else {
        const { error } = await supabase.from('properties').insert({
          title: title.trim(),
          description: description.trim(),
          type,
          category,
          price: numPrice,
          location: location.trim(),
          status: 'available',
          image_urls: uploadedUrls,
          owner_id: selectedLandlordId,
        });

        if (error) throw error;
        Alert.alert('Success', 'New property listed successfully.');
      }

      setModalVisible(false);
      resetForm();
      fetchProperties();
    } catch (err: any) {
      console.error('Property save error:', err);
      Alert.alert('Error', 'Failed to save property details.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatPrice = (p: number, t: string) => {
    const formatted = new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0,
    }).format(p);
    return t === 'rental' ? `${formatted}/month` : formatted;
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
                {item.image_urls?.[0] ? (
                  <Image source={{ uri: item.image_urls[0] }} style={styles.cardImage} />
                ) : null}

                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      item.status === 'available' ? styles.statusAvail : styles.statusRented,
                    ]}
                  >
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

                <View style={styles.infoRow}>
                  <User size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>
                    Owner: {item.profiles?.full_name || 'Agency Owned'}
                  </Text>
                </View>

                <Text style={styles.price}>{formatPrice(item.price, item.type)}</Text>
                <Text style={styles.desc} numberOfLines={2}>
                  {item.description}
                </Text>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleEdit(item)}>
                    <Edit2 size={14} color="#38BDF8" style={styles.actionIcon} />
                    <Text style={styles.actionBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.deleteBtn]}
                    onPress={() => handleDelete(item.id)}
                  >
                    <Trash2 size={14} color="#EF4444" style={styles.actionIcon} />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
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

          <TouchableOpacity
            style={styles.fab}
            onPress={() => {
              resetForm();
              setModalVisible(true);
            }}
          >
            <Plus size={24} color="#0F172A" />
          </TouchableOpacity>
        </>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingId ? 'Edit Property Listing' : 'Add New Property Listing'}
              </Text>
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Listing Type</Text>
                <View style={styles.toggleContainer}>
                  {(['rental', 'sale'] as const).map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.toggleBtn, type === t && styles.toggleBtnActive]}
                      onPress={() => setType(t)}
                    >
                      <Text style={[styles.toggleBtnText, type === t && styles.toggleBtnTextActive]}>
                        {t.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.toggleContainer}>
                  {(['residential', 'commercial', 'land'] as const).map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.toggleBtn, category === c && styles.toggleBtnActive]}
                      onPress={() => setCategory(c)}
                    >
                      <Text style={[styles.toggleBtnText, category === c && styles.toggleBtnTextActive]}>
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Select Owner (Landlord)</Text>
                <View style={styles.ownerGrid}>
                  <TouchableOpacity
                    style={[
                      styles.ownerBtn,
                      selectedLandlordId === null && styles.ownerBtnActive,
                    ]}
                    onPress={() => setSelectedLandlordId(null)}
                  >
                    <Text
                      style={[
                        styles.ownerText,
                        selectedLandlordId === null && styles.ownerTextActive,
                      ]}
                    >
                      Agency Owned (No Landlord)
                    </Text>
                  </TouchableOpacity>
                  {landlords.map((l) => (
                    <TouchableOpacity
                      key={l.id}
                      style={[
                        styles.ownerBtn,
                        selectedLandlordId === l.id && styles.ownerBtnActive,
                      ]}
                      onPress={() => setSelectedLandlordId(l.id)}
                    >
                      <Text
                        style={[
                          styles.ownerText,
                          selectedLandlordId === l.id && styles.ownerTextActive,
                        ]}
                      >
                        {l.full_name} ({l.email})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Image Picker */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Property Photos (up to 5)</Text>

                {selectedImages.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.imagePreviewRow}
                  >
                    {selectedImages.map((img, index) => (
                      <View key={`${img.uri}-${index}`} style={styles.imagePreviewWrapper}>
                        <Image source={{ uri: img.uri }} style={styles.imagePreview} />
                        <TouchableOpacity
                          style={styles.imageRemoveBtn}
                          onPress={() => handleRemoveImage(index)}
                        >
                          <X size={12} color="#F8FAFC" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}

                {selectedImages.length < 5 && (
                  <TouchableOpacity style={styles.imagePickerBtn} onPress={handlePickImages}>
                    <Camera size={20} color="#38BDF8" />
                    <Text style={styles.imagePickerText}>
                      {selectedImages.length === 0 ? 'Add Photos' : 'Add More Photos'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>{editingId ? 'Save Changes' : 'List Property'}</Text>
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
  cardImage: {
    width: '100%',
    height: 140,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#0F172A',
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
  actionRow: {
    flexDirection: 'row',
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
    marginRight: 6,
  },
  deleteBtn: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    marginRight: 0,
    marginLeft: 6,
  },
  actionIcon: {
    marginRight: 6,
  },
  actionBtnText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 13,
  },
  deleteBtnText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 13,
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
    maxHeight: '92%',
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
  imagePreviewRow: {
    marginBottom: 12,
  },
  imagePreviewWrapper: {
    marginRight: 10,
    position: 'relative',
  },
  imagePreview: {
    width: 90,
    height: 90,
    borderRadius: 8,
    backgroundColor: '#0F172A',
  },
  imageRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#38BDF8',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 14,
    backgroundColor: 'rgba(56, 189, 248, 0.05)',
    gap: 8,
  },
  imagePickerText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 14,
  },
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
  ownerGrid: {
    marginVertical: 4,
  },
  ownerBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  ownerBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  ownerText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  ownerTextActive: {
    color: '#38BDF8',
    fontWeight: 'bold',
  },
});
