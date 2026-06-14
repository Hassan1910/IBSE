import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { Plus, Wrench, X, Clock, HelpCircle, CheckCircle } from 'lucide-react-native';

interface MaintenanceRequest {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'resolved';
  created_at: string;
  properties: {
    title: string;
  };
}

export default function TenantMaintenanceScreen() {
  const { user } = useUser();
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState<any>(null);

  // New Request Form States
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [submitting, setSubmitting] = useState(false);

  // Fetch tenant's active lease and historical requests
  const fetchData = async () => {
    if (!user) return;
    try {
      setLoading(true);

      // Fetch active lease to know which property to assign ticket to
      const { data: leaseData } = await supabase
        .from('leases')
        .select('property_id, properties(title)')
        .eq('tenant_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      setLease(leaseData);

      // Fetch tickets
      const { data: tickets, error } = await supabase
        .from('maintenance_requests')
        .select(`
          id,
          title,
          description,
          priority,
          status,
          created_at,
          properties ( title )
        `)
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
      const { error } = await supabase.from('maintenance_requests').insert({
        property_id: lease.property_id,
        tenant_id: user.id,
        title: title.trim(),
        description: description.trim(),
        priority,
        status: 'pending',
      });

      if (error) throw error;

      Alert.alert('Success 🎉', 'Your maintenance ticket has been submitted. Technicians will visit shortly.');
      setModalVisible(false);
      setTitle('');
      setDescription('');
      fetchData(); // reload lists
    } catch (err: any) {
      console.error('Submit ticket error:', err);
      Alert.alert('Error', 'Failed to submit maintenance request.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

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
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {renderStatus(item.status)}
                </View>
                <Text style={styles.propTitle}>Property: {item.properties?.title}</Text>
                
                <Text style={styles.desc}>{item.description}</Text>

                <View style={styles.cardFooter}>
                  <Text style={styles.date}>{formatDate(item.created_at)}</Text>
                  <View style={styles.priorityRow}>
                    <Text style={styles.priorityLabel}>Priority: </Text>
                    <Text style={[styles.priorityVal, { color: getPriorityColor(item.priority) }]}>
                      {item.priority.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>
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
});
