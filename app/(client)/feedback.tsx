import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { Send, MessageSquare, AlertCircle, HelpCircle } from 'lucide-react-native';

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

export default function FeedbackScreen() {
  const { user } = useUser();
  const [mode, setMode] = useState<ViewMode>('submit');
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('inquiry');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<FeedbackItem[]>([]);

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
      console.error('Fetch client feedback history error:', err);
      Alert.alert('Error', 'Failed to load your feedback history.');
    } finally {
      setLoadingHistory(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (mode === 'history') {
      fetchHistory();
    }
  }, [mode, fetchHistory]);

  const handleSubmit = async () => {
    if (!user) return;

    if (!message.trim()) {
      Alert.alert('Validation Error', 'Please type a message before submitting.');
      return;
    }

    try {
      setSubmitting(true);

      const { error } = await supabase.from('feedback').insert({
        user_id: user.id,
        type: feedbackType,
        message: message.trim(),
      });

      if (error) throw error;

      Alert.alert('Thank You! 🌟', 'Your submission has been received. Our team will review and follow up if necessary.');
      setMessage('');
    } catch (err: any) {
      console.error('Feedback submission error:', err);
      Alert.alert('Error', err.message || 'Failed to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderModeToggle = () => (
    <View style={styles.modeRow}>
      {(['submit', 'history'] as ViewMode[]).map((m) => (
        <TouchableOpacity
          key={m}
          style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
          onPress={() => setMode(m)}
        >
          <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
            {m === 'submit' ? 'SUBMIT' : 'HISTORY'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (mode === 'history') {
    return (
      <View style={styles.container}>
        {renderModeToggle()}
        {loadingHistory ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#38BDF8" />
          </View>
        ) : (
          <FlatList
            data={history}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.historyList}
            onRefresh={fetchHistory}
            refreshing={loadingHistory}
            renderItem={({ item }) => (
              <View style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyType}>{item.type.toUpperCase()}</Text>
                  <Text
                    style={[
                      styles.statusPill,
                      item.status === 'resolved' ? styles.statusResolved : styles.statusOpen,
                    ]}
                  >
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
                <Text style={styles.historyDate}>
                  {new Date(item.created_at).toLocaleDateString('en-KE')}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.centered}>
                <Text style={styles.emptyText}>You haven't submitted any feedback yet.</Text>
              </View>
            }
          />
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {renderModeToggle()}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>How can we help you?</Text>
          <Text style={styles.infoText}>
            Select a feedback type and type your message. We read all submissions and reply to inquiries within 24 hours.
          </Text>

          {/* Type Selectors */}
          <View style={styles.typeRow}>
            {FEEDBACK_TYPES.map((type) => {
              const IconComp = type.icon;
              const isSelected = feedbackType === type.value;
              return (
                <TouchableOpacity
                  key={type.value}
                  style={[
                    styles.typeBtn,
                    isSelected && { borderColor: type.color, backgroundColor: `${type.color}15` },
                  ]}
                  onPress={() => setFeedbackType(type.value)}
                >
                  <IconComp size={20} color={isSelected ? type.color : '#94A3B8'} />
                  <Text
                    style={[
                      styles.typeLabel,
                      isSelected && { color: type.color, fontWeight: 'bold' },
                    ]}
                  >
                    {type.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Text message box */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Your Message</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Tell us what is on your mind..."
              placeholderTextColor="#999"
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <>
                <Send size={18} color="#0F172A" style={styles.btnIcon} />
                <Text style={styles.submitBtnText}>Submit Feedback</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Company Quick Contact Info */}
        <View style={styles.contactCard}>
          <Text style={styles.contactTitle}>IBSA Homes Marsabit Office</Text>
          <Text style={styles.contactText}>📞 Call: 0768578050</Text>
          <Text style={styles.contactText}>💬 WhatsApp: 0742034932</Text>
          <Text style={styles.contactText}>✉️ Email: Ibsahomes020@gmail.com</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 20,
    padding: 4,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 6,
    paddingVertical: 10,
  },
  modeBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  modeText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 12,
  },
  modeTextActive: {
    color: '#38BDF8',
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderColor: '#334155',
    borderWidth: 1,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 10,
    textAlign: 'center',
  },
  infoText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  typeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  typeBtn: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  typeLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 6,
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
  textArea: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 16,
    color: '#F8FAFC',
    fontSize: 15,
    height: 120,
  },
  submitBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 4,
  },
  btnIcon: {
    marginRight: 8,
  },
  submitBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
  contactCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderColor: '#334155',
    borderWidth: 1,
    alignItems: 'center',
  },
  contactTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginBottom: 10,
  },
  contactText: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 6,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
  },
  historyList: {
    padding: 16,
    flexGrow: 1,
  },
  historyCard: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  historyType: {
    color: '#38BDF8',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statusPill: {
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  statusOpen: {
    color: '#EAB308',
    backgroundColor: 'rgba(234,179,8,0.15)',
  },
  statusResolved: {
    color: '#10B981',
    backgroundColor: 'rgba(16,185,129,0.15)',
  },
  historyMessage: {
    color: '#F8FAFC',
    fontSize: 14,
    lineHeight: 20,
  },
  replyBox: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#38BDF8',
    marginTop: 10,
    borderRadius: 6,
    padding: 10,
  },
  replyLabel: {
    color: '#38BDF8',
    fontWeight: 'bold',
    fontSize: 11,
    marginBottom: 4,
  },
  replyText: {
    color: '#F8FAFC',
    fontSize: 13,
    lineHeight: 18,
  },
  historyDate: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 10,
  },
});
