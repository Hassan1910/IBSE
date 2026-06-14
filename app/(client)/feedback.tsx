import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
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
];

export default function FeedbackScreen() {
  const { user } = useUser();
  const [feedbackType, setFeedbackType] = useState<'inquiry' | 'suggestion' | 'complaint'>('inquiry');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
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
                  onPress={() => setFeedbackType(type.value as any)}
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
});
