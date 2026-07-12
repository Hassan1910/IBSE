import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { pickImages, uploadImage, type PickedImage } from '../../lib/storage';
import { notifyPropertyOwner } from '../../lib/notifications';
import { useAudit } from '../../hooks/useAudit';
import { Camera, CheckCircle, ClipboardList, Clock, DollarSign, HelpCircle, Plus, Wrench, X } from 'lucide-react-native';

function newRequestId() {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface MaintenanceRequest {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'resolved';
  image_urls: string[] | null;
  tenant_confirmed_at: string | null;
  assigned_to: string | null;
  expense_amount: number | null;
  created_at: string;
  properties: {
    title: string;
  };
}

export default function TenantMaintenanceScreen() {
  const { user } = useUser();
  const { log } = useAudit();
  const router = useRouter();
  const { id: focusId } = useLocalSearchParams<{ id?: string }>();
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState<any>(null);

  // New Request Form States
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [selectedImages, setSelectedImages] = useState<PickedImage[]>([]);
  const [detailItem, setDetailItem] = useState<MaintenanceRequest | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Fetch tenant's active lease and historical requests
  const fetchData = async () => {
    if (!user) return;
    try {
      setLoading(true);

      // Fetch active lease to know which property to assign ticket to
      const { data: leaseData, error: leaseError } = await supabase
        .from('leases')
        .select('property_id, properties(title)')
        .eq('tenant_id', user.id)
        .eq('status', 'active')
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (leaseError) throw leaseError;

      setLease(leaseData);

      // Fetch tickets
      const { data: tickets, error } = await supabase
        .from('maintenance_requests')
        .select('id, title, description, priority, status, image_urls, tenant_confirmed_at, assigned_to, expense_amount, created_at, properties ( title )')
        .eq('tenant_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests((tickets as any) || []);
    } catch (err: any) {
      console.error('Fetch tickets error:', err);
      Alert.alert('Error', 'Failed to load maintenance tickets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id) fetchData();
    }, [user?.id]),
  );

  // Open the specific ticket when arriving from a notification deep link.
  useEffect(() => {
    if (!focusId || loading) return;
    const match = requests.find((r) => r.id === focusId);
    if (!match) return;
    setDetailItem(match);
    setDetailVisible(true);
    router.setParams({ id: undefined });
  }, [focusId, loading, requests, router]);

  const handlePickImages = async () => {
    try {
      const picked = await pickImages(true);
      if (picked.length) setSelectedImages(picked);
    } catch (err: any) {
      Alert.alert('Image Picker', err.message || 'Failed to pick images.');
    }
  };

  const uploadMaintenanceImages = async (requestId: string) => {
    if (!user?.id || !selectedImages.length) return [];
    const urls: string[] = [];
    for (let idx = 0; idx < selectedImages.length; idx += 1) {
      const path = `${user.id}/${requestId}/image-${idx + 1}.jpg`;
      const url = await uploadImage('maintenance-images', path, selectedImages[idx]);
      urls.push(url);
    }
    return urls;
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!lease) {
      Alert.alert('Lease Required', 'You must have an active lease to file a maintenance ticket.');
      return;
    }
    if (!title.trim() || !description.trim()) {
      Alert.alert('Validation Error', 'Please fill in the title and description.');
      return;
    }

    try {
      setSubmitting(true);
      // Upload photos first, then insert with image_urls so we don't rely on a
      // follow-up UPDATE (previously blocked by RLS for pending tickets).
      const requestId = newRequestId();
      const imageUrls = selectedImages.length ? await uploadMaintenanceImages(requestId) : [];

      const { error } = await supabase.from('maintenance_requests').insert({
        id: requestId,
        property_id: lease.property_id,
        tenant_id: user.id,
        title: title.trim(),
        description: description.trim(),
        priority,
        status: 'pending',
        image_urls: imageUrls,
      });

      if (error) throw error;

      await log({
        action: 'create',
        entityType: 'maintenance',
        entityId: requestId,
        description: 'Tenant submitted maintenance request.',
      });

      try {
        await notifyPropertyOwner({
          propertyId: lease.property_id,
          type: 'maintenance_update',
          title: 'New Maintenance Request',
          body: `"${title.trim()}" (${priority}) was submitted by a tenant.`,
          entityType: 'maintenance',
          entityId: requestId,
        });
      } catch (notifyErr) {
        console.error('Notify landlord of maintenance error:', notifyErr);
      }

      Alert.alert('Success 🎉', 'Your maintenance ticket has been submitted. Technicians will visit shortly.');
      setModalVisible(false);
      setTitle('');
      setDescription('');
      setSelectedImages([]);
      fetchData(); // reload lists
    } catch (err: any) {
      console.error('Submit ticket error:', err);
      Alert.alert('Error', err?.message || 'Failed to submit maintenance request.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('en-KE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const formatPrice = (p: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(p);

  const photoUrls = (item: MaintenanceRequest) =>
    Array.isArray(item.image_urls) ? item.image_urls.filter(Boolean) : [];

  const renderStatus = (status: string) => {
    switch (status) {
      case 'resolved':
        return (
          <View style={[styles.statusBadge, styles.statusResolved]}>
            <CheckCircle size={12} color="#10B981" style={styles.badgeIcon} />
            <Text style={[styles.statusText, styles.textResolved]}>Resolved</Text>
          </View>
        );
      case 'in_progress':
        return (
          <View style={[styles.statusBadge, styles.statusProgress]}>
            <Clock size={12} color="#38BDF8" style={styles.badgeIcon} />
            <Text style={[styles.statusText, styles.textProgress]}>In Progress</Text>
          </View>
        );
      default:
        return (
          <View style={[styles.statusBadge, styles.statusPending]}>
            <HelpCircle size={12} color="#EAB308" style={styles.badgeIcon} />
            <Text style={[styles.statusText, styles.textPending]}>Pending</Text>
          </View>
        );
    }
  };

  const getPriorityColor = (p: string) => {
    if (p === 'high') return '#EF4444';
    if (p === 'medium') return '#EAB308';
    return '#10B981';
  };

  const confirmRepair = async (item: MaintenanceRequest) => {
    if (!item || item.status !== 'resolved') return;
    try {
      setConfirming(true);
      const confirmedAt = new Date().toISOString();
      const { error } = await supabase
        .from('maintenance_requests')
        .update({ tenant_confirmed_at: confirmedAt })
        .eq('id', item.id);
      if (error) throw error;

      await log({
        action: 'update',
        entityType: 'maintenance',
        entityId: item.id,
        description: 'Tenant confirmed maintenance repair completion.',
      });

      setDetailVisible(false);
      fetchData();
      Alert.alert('Confirmed', 'Repair has been marked as confirmed.');
    } catch (err) {
      console.error('Confirm repair error:', err);
      Alert.alert('Error', 'Failed to confirm repair.');
    } finally {
      setConfirming(false);
    }
  };

  const timelineStatus = useMemo(() => {
    if (!detailItem) return '';
    if (detailItem.tenant_confirmed_at) return 'Confirmed by tenant';
    if (detailItem.status === 'resolved') return 'Resolved - waiting your confirmation';
    if (detailItem.status === 'in_progress') return 'Technician is working on it';
    return 'Ticket submitted - waiting assignment';
  }, [detailItem]);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          <FlatList
            data={requests}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.card}
                onPress={() => {
                  setDetailItem(item);
                  setDetailVisible(true);
                }}
                activeOpacity={0.9}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {renderStatus(item.status)}
                </View>
                <Text style={styles.propTitle}>Property: {item.properties?.title}</Text>
                
                <Text style={styles.desc}>{item.description}</Text>

                {photoUrls(item).length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cardImageRow}>
                    {photoUrls(item).map((uri) => (
                      <Image key={uri} source={{ uri }} style={styles.cardImage} />
                    ))}
                  </ScrollView>
                ) : null}

                {item.assigned_to ? (
                  <View style={styles.infoRow}>
                    <ClipboardList size={14} color="#38BDF8" style={styles.infoIcon} />
                    <Text style={styles.infoText}>Assigned to: {item.assigned_to}</Text>
                  </View>
                ) : null}
                {item.expense_amount != null ? (
                  <View style={styles.infoRow}>
                    <DollarSign size={14} color="#38BDF8" style={styles.infoIcon} />
                    <Text style={styles.infoText}>Cost: {formatPrice(item.expense_amount)}</Text>
                  </View>
                ) : null}

                <View style={styles.cardFooter}>
                  <Text style={styles.date}>{formatDateTime(item.created_at)}</Text>
                  <View style={styles.priorityRow}>
                    <Text style={styles.priorityLabel}>Priority: </Text>
                    <Text style={[styles.priorityVal, { color: getPriorityColor(item.priority) }]}>
                      {item.priority.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.listContainer}
            onRefresh={fetchData}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <Wrench size={40} color="#94A3B8" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>You haven't filed any maintenance tickets yet.</Text>
              </View>
            }
          />

          {lease && (
            <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
              <Plus size={24} color="#0F172A" />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* New Request Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>File Maintenance Ticket</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Issue Summary / Title</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Leaking kitchen sink"
                  placeholderTextColor="#999"
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Detailed Description</Text>
                <TextInput
                  style={[styles.modalInput, styles.textArea]}
                  placeholder="Describe the issue, location, and severity in detail..."
                  placeholderTextColor="#999"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Set Priority</Text>
                <View style={styles.prioritySelectRow}>
                  {(['low', 'medium', 'high'] as const).map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.priorityBtn,
                        priority === p && {
                          borderColor: getPriorityColor(p),
                          backgroundColor: `${getPriorityColor(p)}15`,
                        },
                      ]}
                      onPress={() => setPriority(p)}
                    >
                      <Text
                        style={[
                          styles.priorityText,
                          priority === p && { color: getPriorityColor(p), fontWeight: 'bold' },
                        ]}
                      >
                        {p.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Issue Photos (optional)</Text>
                <TouchableOpacity style={styles.imagePickerBtn} onPress={handlePickImages}>
                  <Camera size={16} color="#38BDF8" style={{ marginRight: 8 }} />
                  <Text style={styles.imagePickerText}>Select Photos</Text>
                </TouchableOpacity>
                {selectedImages.length > 0 ? (
                  <View style={styles.imagePreviewRow}>
                    {selectedImages.map((img) => (
                      <Image key={img.uri} source={{ uri: img.uri }} style={styles.previewImage} />
                    ))}
                  </View>
                ) : null}
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>Submit Maintenance Request</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={detailVisible} onRequestClose={() => setDetailVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ticket Details</Text>
              <TouchableOpacity onPress={() => setDetailVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            {detailItem ? (
              <ScrollView contentContainerStyle={styles.modalBody}>
                <Text style={styles.detailTitle}>{detailItem.title}</Text>
                <Text style={styles.detailMeta}>Property: {detailItem.properties?.title}</Text>
                <Text style={styles.detailMeta}>Status: {detailItem.status.replace('_', ' ').toUpperCase()}</Text>
                <Text style={styles.detailMeta}>Priority: {detailItem.priority.toUpperCase()}</Text>
                <Text style={styles.detailMeta}>Reported: {formatDateTime(detailItem.created_at)}</Text>
                {detailItem.assigned_to ? (
                  <Text style={styles.detailMeta}>Assigned to: {detailItem.assigned_to}</Text>
                ) : null}
                {detailItem.expense_amount != null ? (
                  <Text style={styles.detailMeta}>Cost: {formatPrice(detailItem.expense_amount)}</Text>
                ) : null}
                <Text style={styles.detailTimeline}>{timelineStatus}</Text>
                <Text style={styles.detailDescription}>{detailItem.description}</Text>

                {photoUrls(detailItem).length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.detailImageRow}>
                    {photoUrls(detailItem).map((uri) => (
                      <Image key={uri} source={{ uri }} style={styles.detailImage} />
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.emptyText}>No issue photos attached.</Text>
                )}

                {detailItem.status === 'resolved' ? (
                  <TouchableOpacity
                    style={[styles.submitBtn, detailItem.tenant_confirmed_at ? styles.confirmedBtn : null]}
                    disabled={!!detailItem.tenant_confirmed_at || confirming}
                    onPress={() => confirmRepair(detailItem)}
                  >
                    {confirming ? (
                      <ActivityIndicator color="#0F172A" />
                    ) : (
                      <Text style={styles.submitBtnText}>
                        {detailItem.tenant_confirmed_at ? 'Repair Already Confirmed' : 'Confirm Repair Completion'}
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </ScrollView>
            ) : null}
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
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  propTitle: {
    fontSize: 12,
    color: '#38BDF8',
    fontWeight: '500',
    marginBottom: 12,
  },
  desc: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoIcon: {
    marginRight: 8,
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 10,
  },
  date: {
    fontSize: 11,
    color: '#64748B',
  },
  priorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priorityLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  priorityVal: {
    fontSize: 12,
    fontWeight: 'bold',
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
  statusProgress: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  statusResolved: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
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
  textProgress: {
    color: '#38BDF8',
  },
  textResolved: {
    color: '#10B981',
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
    height: 100,
  },
  prioritySelectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  priorityBtn: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  priorityText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
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
  imagePickerBtn: {
    borderColor: '#38BDF8',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  imagePickerText: { color: '#38BDF8', fontWeight: '600' },
  imagePreviewRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  previewImage: { width: 60, height: 60, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  cardImageRow: { marginBottom: 12 },
  cardImage: {
    width: 88,
    height: 88,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  detailImageRow: { marginBottom: 12 },
  detailImage: {
    width: 140,
    height: 140,
    borderRadius: 10,
    marginRight: 10,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  detailTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  detailMeta: { color: '#94A3B8', marginBottom: 4, fontSize: 13 },
  detailTimeline: { color: '#38BDF8', marginTop: 4, marginBottom: 10, fontWeight: '600' },
  detailDescription: { color: '#F8FAFC', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  confirmedBtn: { opacity: 0.6 },
});
