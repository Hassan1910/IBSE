import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Switch,
  RefreshControl,
} from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { useAudit } from '../../hooks/useAudit';
import { X, Edit2, Settings as SettingsIcon, Info } from 'lucide-react-native';

interface Setting {
  key: string;
  value: string | null;
  label: string;
  description: string | null;
  category: string;
  data_type: 'text' | 'number' | 'boolean';
}

export default function AdminSettingsScreen() {
  const { user } = useUser();
  const { log } = useAudit();

  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Setting | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('system_settings').select('*').order('category');
      if (error) throw error;
      setSettings((data as Setting[]) || []);
    } catch (err) {
      console.error('Fetch settings error:', err);
      Alert.alert('Error', 'Failed to load system settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const persist = async (key: string, value: string, label: string) => {
    const { error } = await supabase
      .from('system_settings')
      .update({ value, updated_by: user?.id ?? null, updated_at: new Date().toISOString() })
      .eq('key', key);
    if (error) throw error;
    log({ action: 'update', entityType: 'setting', entityId: key, description: `Changed ${label}` });
  };

  const toggleBoolean = async (item: Setting) => {
    const next = item.value === 'true' ? 'false' : 'true';
    setSettings((prev) => prev.map((s) => (s.key === item.key ? { ...s, value: next } : s)));
    try {
      await persist(item.key, next, item.label);
    } catch (err) {
      console.error('Toggle setting error:', err);
      Alert.alert('Error', 'Failed to update setting.');
      fetchSettings();
    }
  };

  const openEdit = (item: Setting) => {
    setEditing(item);
    setDraftValue(item.value ?? '');
    setModalVisible(true);
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (editing.data_type === 'number' && draftValue && isNaN(Number(draftValue))) {
      Alert.alert('Validation Error', 'Please enter a valid number.');
      return;
    }
    try {
      setSubmitting(true);
      await persist(editing.key, draftValue.trim(), editing.label);
      setSettings((prev) =>
        prev.map((s) => (s.key === editing.key ? { ...s, value: draftValue.trim() } : s)),
      );
      setModalVisible(false);
    } catch (err) {
      console.error('Save setting error:', err);
      Alert.alert('Error', 'Failed to save setting.');
    } finally {
      setSubmitting(false);
    }
  };

  const categories = Array.from(new Set(settings.map((s) => s.category)));
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchSettings} tintColor="#38BDF8" />}
    >
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          {categories.map((cat) => (
            <View key={cat} style={styles.section}>
              <Text style={styles.sectionTitle}>{cat.toUpperCase()}</Text>
              <View style={styles.card}>
                {settings
                  .filter((s) => s.category === cat)
                  .map((item, idx, arr) => (
                    <View
                      key={item.key}
                      style={[styles.settingRow, idx === arr.length - 1 && styles.settingRowLast]}
                    >
                      <View style={styles.settingInfo}>
                        <Text style={styles.settingLabel}>{item.label}</Text>
                        {item.description ? (
                          <Text style={styles.settingDesc}>{item.description}</Text>
                        ) : null}
                        {item.data_type !== 'boolean' && (
                          <Text style={styles.settingValue}>{item.value || '—'}</Text>
                        )}
                      </View>

                      {item.data_type === 'boolean' ? (
                        <Switch
                          value={item.value === 'true'}
                          onValueChange={() => toggleBoolean(item)}
                          trackColor={{ false: '#334155', true: 'rgba(56,189,248,0.5)' }}
                          thumbColor={item.value === 'true' ? '#38BDF8' : '#94A3B8'}
                        />
                      ) : (
                        <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
                          <Edit2 size={16} color="#38BDF8" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
              </View>
            </View>
          ))}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ABOUT</Text>
            <View style={styles.card}>
              <View style={styles.aboutRow}>
                <Info size={16} color="#38BDF8" style={{ marginRight: 10 }} />
                <Text style={styles.aboutText}>App Version</Text>
                <Text style={styles.aboutValue}>{appVersion}</Text>
              </View>
              <View style={[styles.aboutRow, styles.settingRowLast]}>
                <SettingsIcon size={16} color="#38BDF8" style={{ marginRight: 10 }} />
                <Text style={styles.aboutText}>Platform</Text>
                <Text style={styles.aboutValue}>Expo {Constants.expoConfig?.sdkVersion || '54'}</Text>
              </View>
            </View>
          </View>
        </>
      )}

      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editing?.label}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            {editing && (
              <View style={styles.modalBody}>
                {editing.description ? <Text style={styles.modalDesc}>{editing.description}</Text> : null}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Value</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={draftValue}
                    onChangeText={setDraftValue}
                    placeholder="Enter value"
                    placeholderTextColor="#999"
                    keyboardType={editing.data_type === 'number' ? 'numeric' : 'default'}
                    autoCapitalize="none"
                  />
                </View>
                <TouchableOpacity style={styles.submitBtn} onPress={saveEdit} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.submitBtnText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { padding: 40, alignItems: 'center' },
  section: { marginBottom: 20 },
  sectionTitle: { color: '#94A3B8', fontSize: 12, fontWeight: 'bold', marginBottom: 8, marginLeft: 4, letterSpacing: 1 },
  card: { backgroundColor: '#1E293B', borderRadius: 12, borderColor: '#334155', borderWidth: 1, paddingHorizontal: 16 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  settingRowLast: { borderBottomWidth: 0 },
  settingInfo: { flex: 1, marginRight: 12 },
  settingLabel: { color: '#F8FAFC', fontSize: 15, fontWeight: '600' },
  settingDesc: { color: '#94A3B8', fontSize: 12, marginTop: 2, lineHeight: 17 },
  settingValue: { color: '#38BDF8', fontSize: 14, fontWeight: '600', marginTop: 4 },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.05)',
  },
  aboutRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#334155' },
  aboutText: { color: '#F8FAFC', fontSize: 15, flex: 1 },
  aboutValue: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 14,
    marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 8 },
  modalBody: { paddingBottom: 20 },
  modalDesc: { color: '#94A3B8', fontSize: 13, lineHeight: 19, marginBottom: 16 },
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
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
