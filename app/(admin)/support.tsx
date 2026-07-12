import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAudit } from '../../hooks/useAudit';
import { notifyUser } from '../../lib/notifications';
import { X, MessageSquare, Reply, CheckCircle, Trash2, Inbox } from 'lucide-react-native';

interface Feedback {
  id: string;
  user_id: string;
  type: 'complaint' | 'suggestion' | 'inquiry';
  message: string;
  status: 'open' | 'resolved';
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
  profiles: { full_name: string; email: string } | null;
}

type Filter = 'open' | 'resolved' | 'all';

export default function AdminSupportScreen() {
  const { user } = useUser();
  const { log } = useAudit();
  const router = useRouter();
  const { id: focusId } = useLocalSearchParams<{ id?: string }>();

  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('open');

  const [modalVisible, setModalVisible] = useState(false);
  const [selected, setSelected] = useState<Feedback | null>(null);
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchFeedback = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('feedback')
        .select(`id, user_id, type, message, status, admin_reply, replied_at, created_at, profiles!feedback_user_id_fkey ( full_name, email )`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setFeedback((data as any) || []);
    } catch (err) {
      console.error('Fetch feedback error:', err);
      Alert.alert('Error', 'Failed to load feedback.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  useEffect(() => {
    if (!focusId || loading) return;
    const match = feedback.find((f) => f.id === focusId);
    if (!match) return;
    setFilter(match.status === 'resolved' ? 'resolved' : 'open');
    openReply(match);
    router.setParams({ id: undefined });
  }, [focusId, loading, feedback, router]);

  const visible = feedback.filter((f) => (filter === 'all' ? true : f.status === filter));

  const openReply = (item: Feedback) => {
    setSelected(item);
    setReply(item.admin_reply || '');
    setModalVisible(true);
  };

  const submitReply = async (markResolved: boolean) => {
    if (!selected) return;
    if (!reply.trim()) {
      Alert.alert('Validation Error', 'Please write a response.');
      return;
    }
    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('feedback')
        .update({
          admin_reply: reply.trim(),
          replied_at: new Date().toISOString(),
          replied_by: user?.id ?? null,
          status: markResolved ? 'resolved' : 'open',
        })
        .eq('id', selected.id);
      if (error) throw error;
      log({
        action: 'reply',
        entityType: 'feedback',
        entityId: selected.id,
        description: `Responded to ${selected.type}`,
      });
      await notifyUser({
        userId: selected.user_id,
        type: 'feedback_reply',
        title: 'Support Team Replied',
        body: `Your ${selected.type} has received a response from support.`,
        entityType: 'feedback',
        entityId: selected.id,
      });
      setModalVisible(false);
      setReply('');
      fetchFeedback();
    } catch (err) {
      console.error('Reply feedback error:', err);
      Alert.alert('Error', 'Failed to send response.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleResolved = async (item: Feedback) => {
    const nextStatus = item.status === 'resolved' ? 'open' : 'resolved';
    try {
      const { error } = await supabase.from('feedback').update({ status: nextStatus }).eq('id', item.id);
      if (error) throw error;
      setFeedback((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: nextStatus } : f)));
      log({ action: 'update', entityType: 'feedback', entityId: item.id, description: `Marked ${nextStatus}` });
    } catch (err) {
      console.error('Toggle resolved error:', err);
      Alert.alert('Error', 'Failed to update status.');
    }
  };

  const handleDelete = (item: Feedback) => {
    Alert.alert('Delete Feedback', 'Permanently remove this feedback record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('feedback').delete().eq('id', item.id);
            if (error) throw error;
            setFeedback((prev) => prev.filter((f) => f.id !== item.id));
            log({ action: 'delete', entityType: 'feedback', entityId: item.id });
          } catch (err) {
            console.error('Delete feedback error:', err);
            Alert.alert('Error', 'Failed to delete feedback.');
          }
        },
      },
    ]);
  };

  const typeColors = (type: string) => {
    switch (type) {
      case 'complaint':
        return { bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444', text: '#EF4444' };
      case 'suggestion':
        return { bg: 'rgba(56, 189, 248, 0.15)', border: '#38BDF8', text: '#38BDF8' };
      default:
        return { bg: 'rgba(234, 179, 8, 0.15)', border: '#EAB308', text: '#EAB308' };
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });

  const renderHeader = () => (
    <View style={styles.filterRow}>
      {(['open', 'resolved', 'all'] as Filter[]).map((f) => (
        <TouchableOpacity
          key={f}
          style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
          onPress={() => setFilter(f)}
        >
          <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
            {f.toUpperCase()}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => {
            const colors = typeColors(item.type);
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.userName}>{item.profiles?.full_name || 'Anonymous User'}</Text>
                  <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                    <Text style={[styles.badgeText, { color: colors.text }]}>{item.type.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.email}>{item.profiles?.email}</Text>

                <View style={styles.messageBox}>
                  <MessageSquare size={16} color="#94A3B8" style={{ marginRight: 6, marginTop: 2 }} />
                  <Text style={styles.message}>{item.message}</Text>
                </View>

                {item.admin_reply ? (
                  <View style={styles.replyBox}>
                    <Text style={styles.replyLabel}>Your response</Text>
                    <Text style={styles.replyText}>{item.admin_reply}</Text>
                  </View>
                ) : null}

                <View style={styles.metaRow}>
                  <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
                  <View
                    style={[
                      styles.statusPill,
                      item.status === 'resolved' ? styles.statusResolved : styles.statusOpen,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        { color: item.status === 'resolved' ? '#10B981' : '#EAB308' },
                      ]}
                    >
                      {item.status.toUpperCase()}
                    </Text>
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={[styles.actionBtn, styles.replyBtn]} onPress={() => openReply(item)}>
                    <Reply size={15} color="#38BDF8" style={styles.btnIcon} />
                    <Text style={styles.replyBtnText}>{item.admin_reply ? 'Edit Reply' : 'Reply'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.resolveBtn]} onPress={() => toggleResolved(item)}>
                    <CheckCircle size={15} color="#0F172A" style={styles.btnIcon} />
                    <Text style={styles.resolveBtnText}>
                      {item.status === 'resolved' ? 'Reopen' : 'Resolve'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(item)}>
                    <Trash2 size={15} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchFeedback}
          refreshing={loading}
          ListEmptyComponent={
            <View style={styles.emptyCentered}>
              <Inbox size={48} color="#94A3B8" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No {filter === 'all' ? '' : filter} feedback found.</Text>
            </View>
          }
        />
      )}

      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Respond to User</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selected && (
              <View style={styles.modalBody}>
                <Text style={styles.modalSubText}>{selected.profiles?.full_name}</Text>
                <View style={styles.messageBox}>
                  <Text style={styles.message}>{selected.message}</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Your Response</Text>
                  <TextInput
                    style={[styles.modalInput, styles.textArea]}
                    placeholder="Type your response to the user..."
                    placeholderTextColor="#999"
                    value={reply}
                    onChangeText={setReply}
                    multiline
                  />
                </View>

                <TouchableOpacity style={styles.submitBtn} onPress={() => submitReply(true)} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.submitBtnText}>Send & Resolve</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => submitReply(false)}
                  disabled={submitting}
                >
                  <Text style={styles.secondaryBtnText}>Save Reply (keep open)</Text>
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
  container: { flex: 1, backgroundColor: '#0F172A' },
  listContainer: { padding: 16 },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 4,
    marginBottom: 16,
  },
  filterBtn: { flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  filterBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: 'rgba(56, 189, 248, 0.2)',
    borderWidth: 1,
  },
  filterText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  filterTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  userName: { fontSize: 15, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 8 },
  email: { color: '#94A3B8', fontSize: 12, marginBottom: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: 'bold' },
  messageBox: { flexDirection: 'row', backgroundColor: '#0F172A', borderRadius: 8, padding: 12, marginBottom: 10 },
  message: { color: '#F8FAFC', fontSize: 14, lineHeight: 20, flex: 1 },
  replyBox: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: '#38BDF8',
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
  },
  replyLabel: { color: '#38BDF8', fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  replyText: { color: '#F8FAFC', fontSize: 13, lineHeight: 19 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  dateText: { color: '#64748B', fontSize: 11 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  statusOpen: { borderColor: 'rgba(234,179,8,0.4)', backgroundColor: 'rgba(234,179,8,0.1)' },
  statusResolved: { borderColor: 'rgba(16,185,129,0.4)', backgroundColor: 'rgba(16,185,129,0.1)' },
  statusPillText: { fontSize: 10, fontWeight: 'bold' },
  actionRow: { flexDirection: 'row' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  replyBtn: { flex: 1, borderColor: '#38BDF8', borderWidth: 1, marginRight: 6 },
  replyBtnText: { color: '#38BDF8', fontWeight: '600', fontSize: 13 },
  resolveBtn: { flex: 1, backgroundColor: '#38BDF8', marginRight: 6 },
  resolveBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 13 },
  deleteBtn: {
    width: 44,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderWidth: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  btnIcon: { marginRight: 6 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCentered: { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 40 },
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
  modalSubText: { fontSize: 15, color: '#38BDF8', fontWeight: '600', marginBottom: 10 },
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
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { color: '#94A3B8', fontSize: 14, textDecorationLine: 'underline' },
});
