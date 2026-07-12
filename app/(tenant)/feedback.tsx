import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { useAudit } from '../../hooks/useAudit';
import { AlertCircle, HelpCircle, MessageSquare, Send } from 'lucide-react-native';

const FEEDBACK_TYPES = [
  { label: 'Inquiry', value: 'inquiry', icon: HelpCircle, color: '#38BDF8' },
  { label: 'Suggestion', value: 'suggestion', icon: MessageSquare, color: '#10B981' },
  { label: 'Complaint', value: 'complaint', icon: AlertCircle, color: '#EF4444' },
] as const;

type FeedbackType = (typeof FEEDBACK_TYPES)[number]['value'];
type ViewMode = 'submit' | 'history';

interface FeedbackItem {
  id: string;
  type: FeedbackType;
  message: string;
  status: 'open' | 'resolved';
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
}

export default function TenantFeedbackScreen() {
  const { user } = useUser();
  const { log } = useAudit();
  const router = useRouter();
  const { id: focusId } = useLocalSearchParams<{ id?: string }>();
  const [mode, setMode] = useState<ViewMode>('submit');
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('inquiry');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<FeedbackItem[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoadingHistory(true);
      const { data, error } = await supabase
        .from('feedback')
        .select('id, type, message, status, admin_reply, replied_at, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setHistory((data as FeedbackItem[]) || []);
    } catch (err) {
      console.error('Fetch tenant feedback history error:', err);
      Alert.alert('Error', 'Failed to load feedback history.');
    } finally {
      setLoadingHistory(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (focusId) {
      setMode('history');
      setHighlightedId(focusId);
      router.setParams({ id: undefined });
    }
  }, [focusId, router]);

  useEffect(() => {
    if (mode === 'history') {
      fetchHistory();
    }
  }, [mode, fetchHistory]);

  const handleSubmit = async () => {
    if (!user?.id) return;
    if (!message.trim()) {
      Alert.alert('Validation Error', 'Please type a message before submitting.');
      return;
    }

    try {
      setSubmitting(true);
      const { data, error } = await supabase
        .from('feedback')
        .insert({ user_id: user.id, type: feedbackType, message: message.trim() })
        .select('id')
        .single();

      if (error) throw error;
      await log({
        action: 'create',
        entityType: 'feedback',
        entityId: data?.id,
        description: `Tenant submitted ${feedbackType} feedback.`,
      });
      setMessage('');
      Alert.alert('Thank You', 'Your message has been received.');
    } catch (err: any) {
      console.error('Submit tenant feedback error:', err);
      Alert.alert('Error', err.message || 'Failed to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        {(['submit', 'history'] as ViewMode[]).map((m) => (
          <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && styles.modeBtnActive]} onPress={() => setMode(m)}>
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'submit' ? 'SUBMIT' : 'HISTORY'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'submit' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>How can we help you?</Text>
          <Text style={styles.infoText}>Share any inquiry, suggestion, or complaint and our team will follow up.</Text>
          <View style={styles.typeRow}>
            {FEEDBACK_TYPES.map((type) => {
              const IconComp = type.icon;
              const isSelected = feedbackType === type.value;
              return (
                <TouchableOpacity
                  key={type.value}
                  style={[styles.typeBtn, isSelected && { borderColor: type.color, backgroundColor: `${type.color}20` }]}
                  onPress={() => setFeedbackType(type.value)}
                >
                  <IconComp size={16} color={isSelected ? type.color : '#94A3B8'} />
                  <Text style={[styles.typeLabel, isSelected && { color: type.color }]}>{type.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={styles.textArea}
            placeholder="Type your message..."
            placeholderTextColor="#999"
            multiline
            value={message}
            onChangeText={setMessage}
            textAlignVertical="top"
          />
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#0F172A" /> : <><Send size={16} color="#0F172A" style={{ marginRight: 6 }} /><Text style={styles.submitBtnText}>Submit</Text></>}
          </TouchableOpacity>
        </View>
      ) : loadingHistory ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          onRefresh={fetchHistory}
          refreshing={loadingHistory}
          renderItem={({ item }) => (
            <View style={[styles.historyCard, highlightedId === item.id && styles.highlightedCard]}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyType}>{item.type.toUpperCase()}</Text>
                <Text style={[styles.statusPill, item.status === 'resolved' ? styles.statusResolved : styles.statusOpen]}>
                  {item.status.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.historyMessage}>{item.message}</Text>
              {item.admin_reply ? (
                <View style={styles.replyBox}>
                  <Text style={styles.replyLabel}>Admin Reply</Text>
                  <Text style={styles.replyText}>{item.admin_reply}</Text>
                </View>
              ) : null}
              <Text style={styles.historyDate}>{new Date(item.created_at).toLocaleDateString('en-KE')}</Text>
            </View>
          )}
          ListEmptyComponent={<View style={styles.centered}><Text style={styles.emptyText}>No feedback history yet.</Text></View>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#94A3B8' },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    margin: 16,
    padding: 4,
  },
  modeBtn: { flex: 1, alignItems: 'center', borderRadius: 6, paddingVertical: 10 },
  modeBtnActive: { backgroundColor: 'rgba(56, 189, 248, 0.1)', borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.3)' },
  modeText: { color: '#94A3B8', fontWeight: '600', fontSize: 12 },
  modeTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  card: { marginHorizontal: 16, marginBottom: 16, backgroundColor: '#1E293B', borderColor: '#334155', borderWidth: 1, borderRadius: 12, padding: 16 },
  cardTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: 'bold' },
  infoText: { color: '#94A3B8', marginTop: 6, marginBottom: 12, lineHeight: 19, fontSize: 13 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  typeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  typeLabel: { color: '#94A3B8', marginLeft: 6, fontSize: 12, fontWeight: '600' },
  textArea: { minHeight: 120, borderColor: '#334155', borderWidth: 1, borderRadius: 8, backgroundColor: '#0F172A', color: '#F8FAFC', padding: 12, marginTop: 4, marginBottom: 10 },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', paddingVertical: 12 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold' },
  historyCard: { backgroundColor: '#1E293B', borderColor: '#334155', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 },
  highlightedCard: { borderColor: '#38BDF8', backgroundColor: 'rgba(56, 189, 248, 0.08)' },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  historyType: { color: '#38BDF8', fontWeight: 'bold', fontSize: 12 },
  statusPill: { fontSize: 10, fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  statusOpen: { color: '#EAB308', backgroundColor: 'rgba(234,179,8,0.15)' },
  statusResolved: { color: '#10B981', backgroundColor: 'rgba(16,185,129,0.15)' },
  historyMessage: { color: '#F8FAFC', fontSize: 14, lineHeight: 20 },
  replyBox: { backgroundColor: 'rgba(56, 189, 248, 0.1)', borderLeftWidth: 3, borderLeftColor: '#38BDF8', marginTop: 10, borderRadius: 6, padding: 10 },
  replyLabel: { color: '#38BDF8', fontWeight: 'bold', fontSize: 11, marginBottom: 4 },
  replyText: { color: '#F8FAFC', fontSize: 13, lineHeight: 18 },
  historyDate: { color: '#64748B', fontSize: 11, marginTop: 10 },
});
