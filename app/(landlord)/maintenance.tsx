import React, { useState, useEffect, useRef } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { logAudit } from '../../lib/audit';
import { notifyUser } from '../../lib/notifications';
import MaterialsUsedModal from '../../components/MaterialsUsedModal';
import NotificationBell from '../../components/NotificationBell';
import { Wrench, User as UserIcon, Clock, CheckCircle, ClipboardList, DollarSign, X, Package } from 'lucide-react-native';
import { useInfiniteList } from '../../hooks/queries/useInfiniteList';
import { fetchLandlordMaintenancePage } from '../../hooks/queries/fetchers';
import { queryKeys } from '../../hooks/queries/keys';
import { PAGE_SIZE } from '../../lib/queryClient';
import StorageImage from '../../components/StorageImage';

interface MaintenanceRequest {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'resolved';
  created_at: string;
  assigned_to: string | null;
  expense_amount: number | null;
  image_urls: string[] | null;
  properties: { title: string } | null;
  profiles: { full_name: string } | null;
}

type Filter = 'active' | 'resolved' | 'all';

export default function LandlordMaintenance() {
  const { user } = useUser();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id: focusId } = useLocalSearchParams<{ id?: string }>();
  const userId = user?.id || '';
  const [filter, setFilter] = useState<Filter>('active');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const listRef = useRef<FlatList<MaintenanceRequest>>(null);

  const [assignVisible, setAssignVisible] = useState(false);
  const [activeRequest, setActiveRequest] = useState<MaintenanceRequest | null>(null);
  const [assignedTo, setAssignedTo] = useState('');
  const [expense, setExpense] = useState('');
  const [saving, setSaving] = useState(false);
  const [materialsRequest, setMaterialsRequest] = useState<MaintenanceRequest | null>(null);

  const {
    items: requests,
    loading,
    refreshing,
    loadingMore,
    error,
    refresh,
    loadMore,
  } = useInfiniteList<MaintenanceRequest>(
    queryKeys.landlordMaintenance(userId),
    (page) => fetchLandlordMaintenancePage(userId, page) as any,
    PAGE_SIZE.tables,
    { enabled: !!userId, refetchOnFocus: true }
  );

  useEffect(() => {
    if (error) {
      console.error('Fetch maintenance error:', error);
      Alert.alert('Error', 'Failed to load maintenance requests.');
    }
  }, [error]);

  // Focus the matching ticket when arriving from the dashboard or a notification.
  useEffect(() => {
    if (!focusId || loading) return;
    const match = requests.find((r) => r.id === focusId);
    if (!match) return;
    const nextFilter: Filter = match.status === 'resolved' ? 'resolved' : 'active';
    setFilter(nextFilter);
    setHighlightedId(match.id);
    router.setParams({ id: undefined });

    const visible = requests.filter((r) =>
      nextFilter === 'resolved' ? r.status === 'resolved' : r.status !== 'resolved',
    );
    const index = visible.findIndex((r) => r.id === match.id);
    if (index >= 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
      });
    }
  }, [focusId, loading, requests, router]);

  const invalidateMaintenance = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['landlord', 'maintenance', userId] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.landlordDashboard(userId) }),
    ]);

  const updateStatus = async (item: MaintenanceRequest, nextStatus: 'in_progress' | 'resolved') => {
    try {
      const patch: Record<string, unknown> = { status: nextStatus };
      if (nextStatus === 'resolved') patch.resolved_at = new Date().toISOString();
      const { error: updateError } = await supabase.from('maintenance_requests').update(patch).eq('id', item.id);
      if (updateError) throw updateError;
      logAudit({ actorId: user?.id || '', action: 'update', entityType: 'maintenance', entityId: item.id, description: `Maintenance ${nextStatus}` });
      await notifyUser({
        userId: item.tenant_id,
        type: 'maintenance_update',
        title: 'Maintenance Update',
        body: `"${item.title}" is now ${nextStatus.replace('_', ' ')}.`,
        entityType: 'maintenance',
        entityId: item.id,
      });
      await invalidateMaintenance();
    } catch (err) {
      console.error('Update maintenance error:', err);
      Alert.alert('Error', 'Failed to update request status.');
    }
  };

  const openAssign = (item: MaintenanceRequest) => {
    setActiveRequest(item);
    setAssignedTo(item.assigned_to || '');
    setExpense(item.expense_amount != null ? String(item.expense_amount) : '');
    setAssignVisible(true);
  };

  const handleAssignSave = async () => {
    if (!activeRequest) return;
    const expenseVal = expense.trim() ? parseFloat(expense) : null;
    if (expense.trim() && (isNaN(expenseVal as number) || (expenseVal as number) < 0)) {
      Alert.alert('Validation Error', 'Please enter a valid expense amount.');
      return;
    }
    try {
      setSaving(true);
      const { error: assignError } = await supabase
        .from('maintenance_requests')
        .update({ assigned_to: assignedTo.trim() || null, expense_amount: expenseVal })
        .eq('id', activeRequest.id);
      if (assignError) throw assignError;
      logAudit({ actorId: user?.id || '', action: 'update', entityType: 'maintenance', entityId: activeRequest.id, description: 'Assigned maintenance task' });
      Alert.alert('Success', 'Task assignment saved.');
      setAssignVisible(false);
      setActiveRequest(null);
      await invalidateMaintenance();
    } catch (err) {
      console.error('Assign maintenance error:', err);
      Alert.alert('Error', 'Failed to save assignment.');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
  const formatPrice = (p: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(p);

  const priorityColors = (p: string) => {
    switch (p) {
      case 'high':
        return { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', text: '#EF4444' };
      case 'medium':
        return { bg: 'rgba(234, 179, 8, 0.15)', border: '#EAB308', text: '#EAB308' };
      default:
        return { bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981', text: '#10B981' };
    }
  };

  const filtered = requests.filter((r) =>
    filter === 'all' ? true : filter === 'resolved' ? r.status === 'resolved' : r.status !== 'resolved',
  );

  const renderHeader = () => (
    <View>
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Maintenance</Text>
        <NotificationBell href="/(landlord)/notifications" />
      </View>
      <View style={styles.segment}>
        {(['active', 'resolved', 'all'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.segmentBtn, filter === f && styles.segmentBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.segmentText, filter === f && styles.segmentTextActive]}>{f.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading && requests.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={filtered}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.1 });
            }, 100);
          }}
          renderItem={({ item }) => {
            const colors = priorityColors(item.priority);
            return (
              <View style={[styles.card, highlightedId === item.id && styles.highlightedCard]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.propTitle}>{item.title}</Text>
                  <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                    <Text style={[styles.badgeText, { color: colors.text }]}>{item.priority.toUpperCase()}</Text>
                  </View>
                </View>

                <Text style={styles.locationText}>Property: {item.properties?.title || 'N/A'}</Text>
                <View style={styles.divider} />
                <Text style={styles.desc}>{item.description}</Text>

                {item.image_urls?.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRow}>
                    {item.image_urls.map((uri) => (
                      <StorageImage key={uri} uri={uri} style={styles.issueImage} contentFit="cover" cachePolicy="memory-disk" />
                    ))}
                  </ScrollView>
                ) : null}

                <View style={styles.infoRow}>
                  <UserIcon size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>Tenant: {item.profiles?.full_name || 'N/A'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Clock size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>
                    Reported: {formatDate(item.created_at)} • Status:{' '}
                    <Text style={{ color: item.status === 'in_progress' ? '#38BDF8' : item.status === 'resolved' ? '#10B981' : '#EAB308', fontWeight: 'bold' }}>
                      {item.status.replace('_', ' ').toUpperCase()}
                    </Text>
                  </Text>
                </View>
                {item.assigned_to ? (
                  <View style={styles.infoRow}>
                    <ClipboardList size={14} color="#38BDF8" style={styles.icon} />
                    <Text style={styles.infoText}>Assigned to: {item.assigned_to}</Text>
                  </View>
                ) : null}
                {item.expense_amount != null ? (
                  <View style={styles.infoRow}>
                    <DollarSign size={14} color="#38BDF8" style={styles.icon} />
                    <Text style={styles.infoText}>Cost: {formatPrice(item.expense_amount)}</Text>
                  </View>
                ) : null}

                {item.status !== 'resolved' ? (
                  <>
                    <View style={styles.actionRow}>
                      {item.status === 'pending' ? (
                        <TouchableOpacity style={[styles.actionBtn, styles.startBtn]} onPress={() => updateStatus(item, 'in_progress')}>
                          <Clock size={16} color="#38BDF8" style={styles.btnIcon} />
                          <Text style={styles.startText}>Start Work</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.actionBtn, styles.inProgressBadge]}>
                          <Clock size={14} color="#38BDF8" style={styles.btnIcon} />
                          <Text style={styles.inProgressText}>In Progress</Text>
                        </View>
                      )}
                      <TouchableOpacity style={[styles.actionBtn, styles.resolveBtn]} onPress={() => updateStatus(item, 'resolved')}>
                        <CheckCircle size={16} color="#0F172A" style={styles.btnIcon} />
                        <Text style={styles.resolveText}>Resolve</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity style={styles.assignRow} onPress={() => openAssign(item)}>
                      <ClipboardList size={14} color="#94A3B8" style={styles.btnIcon} />
                      <Text style={styles.assignRowText}>Assign task / record cost</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.assignRow} onPress={() => setMaterialsRequest(item)}>
                      <Package size={14} color="#94A3B8" style={styles.btnIcon} />
                      <Text style={styles.assignRowText}>Record materials used</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
            );
          }}
          contentContainerStyle={styles.listContainer}
          onRefresh={refresh}
          refreshing={refreshing}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color="#38BDF8" />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyCentered}>
              <Wrench size={48} color="#94A3B8" style={styles.emptyIcon} />
              <Text style={styles.emptyText}>No maintenance requests in this view.</Text>
            </View>
          }
        />
      )}

      <MaterialsUsedModal
        visible={!!materialsRequest}
        onClose={() => setMaterialsRequest(null)}
        maintenanceRequestId={materialsRequest?.id || ''}
        maintenanceTitle={materialsRequest?.title || ''}
        userId={user?.id || ''}
      />

      <Modal animationType="slide" transparent visible={assignVisible} onRequestClose={() => setAssignVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign & Record Cost</Text>
              <TouchableOpacity onPress={() => setAssignVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Assigned To (person / vendor)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. John the plumber"
                  placeholderTextColor="#999"
                  value={assignedTo}
                  onChangeText={setAssignedTo}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Maintenance Cost (KES)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 3500"
                  placeholderTextColor="#999"
                  value={expense}
                  onChangeText={setExpense}
                  keyboardType="numeric"
                />
              </View>
              <TouchableOpacity style={styles.submitBtn} onPress={handleAssignSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.submitBtnText}>Save</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  topBarTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 12 },
  listContainer: { padding: 16, flexGrow: 1 },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 4,
    marginBottom: 16,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  segmentBtnActive: { backgroundColor: 'rgba(56, 189, 248, 0.1)', borderColor: 'rgba(56, 189, 248, 0.2)', borderWidth: 1 },
  segmentText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  segmentTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  highlightedCard: {
    borderColor: '#38BDF8',
    borderWidth: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  propTitle: { fontSize: 15, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: 'bold' },
  locationText: { fontSize: 13, color: '#94A3B8', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#334155', marginVertical: 12 },
  desc: { color: '#94A3B8', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  imageRow: { marginBottom: 12 },
  issueImage: {
    width: 96,
    height: 96,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  icon: { marginRight: 8 },
  infoText: { color: '#94A3B8', fontSize: 13 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  startBtn: { borderColor: '#38BDF8', borderWidth: 1, marginRight: 8 },
  startText: { color: '#38BDF8', fontWeight: 'bold' },
  inProgressBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: '#38BDF8',
    borderWidth: 1,
    marginRight: 8,
  },
  inProgressText: { color: '#38BDF8', fontWeight: 'bold', fontSize: 12 },
  resolveBtn: { backgroundColor: '#38BDF8', marginLeft: 8 },
  resolveText: { color: '#0F172A', fontWeight: 'bold' },
  btnIcon: { marginRight: 6 },
  assignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  assignRowText: { color: '#94A3B8', fontSize: 12, fontWeight: '500' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  emptyCentered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, marginTop: 60 },
  emptyIcon: { marginBottom: 12 },
  emptyText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.8)', justifyContent: 'flex-end' },
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
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC' },
  modalBody: { paddingBottom: 20 },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#94A3B8', marginBottom: 6 },
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
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
