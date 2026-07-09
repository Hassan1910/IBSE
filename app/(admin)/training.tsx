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
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useUser } from '@clerk/clerk-expo';
import { useAudit } from '../../hooks/useAudit';
import {
  Plus,
  X,
  Edit2,
  Trash2,
  BookOpen,
  ChevronDown,
  ChevronUp,
  GraduationCap,
} from 'lucide-react-native';

type Audience = 'all' | 'staff' | 'tenant' | 'client';

interface Article {
  id: string;
  title: string;
  category: string;
  audience: Audience;
  body: string;
}

const AUDIENCES: Audience[] = ['all', 'staff', 'tenant', 'client'];

export default function AdminTrainingScreen() {
  const { user } = useUser();
  const { log } = useAudit();

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('general');
  const [audience, setAudience] = useState<Audience>('all');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchArticles = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('help_articles')
        .select('id, title, category, audience, body')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setArticles((data as Article[]) || []);
    } catch (err) {
      console.error('Fetch articles error:', err);
      Alert.alert('Error', 'Failed to load training content.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setCategory('general');
    setAudience('all');
    setBody('');
  };

  const openEdit = (item: Article) => {
    setEditingId(item.id);
    setTitle(item.title);
    setCategory(item.category);
    setAudience(item.audience);
    setBody(item.body);
    setModalVisible(true);
  };

  const handleDelete = (item: Article) => {
    Alert.alert('Delete Article', `Remove "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('help_articles').delete().eq('id', item.id);
            if (error) throw error;
            setArticles((prev) => prev.filter((a) => a.id !== item.id));
            log({ action: 'delete', entityType: 'help_article', entityId: item.id, description: item.title });
          } catch (err) {
            console.error('Delete article error:', err);
            Alert.alert('Error', 'Failed to delete article.');
          }
        },
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) {
      Alert.alert('Validation Error', 'Please enter a title and content.');
      return;
    }
    const payload = {
      title: title.trim(),
      category: category.trim() || 'general',
      audience,
      body: body.trim(),
    };
    try {
      setSubmitting(true);
      if (editingId) {
        const { error } = await supabase
          .from('help_articles')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (error) throw error;
        log({ action: 'update', entityType: 'help_article', entityId: editingId, description: payload.title });
      } else {
        const { error } = await supabase
          .from('help_articles')
          .insert({ ...payload, created_by: user?.id ?? null });
        if (error) throw error;
        log({ action: 'create', entityType: 'help_article', description: payload.title });
      }
      setModalVisible(false);
      resetForm();
      fetchArticles();
    } catch (err) {
      console.error('Save article error:', err);
      Alert.alert('Error', 'Failed to save article.');
    } finally {
      setSubmitting(false);
    }
  };

  const audienceColor = (a: string) => {
    switch (a) {
      case 'staff':
        return '#38BDF8';
      case 'tenant':
        return '#10B981';
      case 'client':
        return '#EAB308';
      default:
        return '#94A3B8';
    }
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
            data={articles}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={
              <Text style={styles.intro}>
                Publish training guides and support articles for staff, tenants, and clients. Users can read
                these from their help sections.
              </Text>
            }
            renderItem={({ item }) => {
              const expanded = expandedId === item.id;
              return (
                <View style={styles.card}>
                  <TouchableOpacity
                    style={styles.cardHeader}
                    onPress={() => setExpandedId(expanded ? null : item.id)}
                  >
                    <View style={styles.titleWrap}>
                      <BookOpen size={16} color="#38BDF8" style={{ marginRight: 8 }} />
                      <Text style={styles.title}>{item.title}</Text>
                    </View>
                    {expanded ? (
                      <ChevronUp size={18} color="#94A3B8" />
                    ) : (
                      <ChevronDown size={18} color="#94A3B8" />
                    )}
                  </TouchableOpacity>

                  <View style={styles.tagRow}>
                    <View style={styles.categoryTag}>
                      <Text style={styles.categoryTagText}>{item.category.toUpperCase()}</Text>
                    </View>
                    <View style={[styles.audienceTag, { borderColor: audienceColor(item.audience) }]}>
                      <Text style={[styles.audienceTagText, { color: audienceColor(item.audience) }]}>
                        {item.audience.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {expanded && <Text style={styles.body}>{item.body}</Text>}

                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
                      <Edit2 size={15} color="#38BDF8" style={{ marginRight: 6 }} />
                      <Text style={styles.editText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.deleteBtn]}
                      onPress={() => handleDelete(item)}
                    >
                      <Trash2 size={15} color="#EF4444" style={{ marginRight: 6 }} />
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
            contentContainerStyle={styles.listContainer}
            onRefresh={fetchArticles}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <GraduationCap size={48} color="#94A3B8" style={{ marginBottom: 12 }} />
                <Text style={styles.emptyText}>No training articles yet.</Text>
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

      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit Article' : 'New Training Article'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Title</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. How to submit rent"
                  placeholderTextColor="#999"
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Category</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. payments, onboarding"
                  placeholderTextColor="#999"
                  value={category}
                  onChangeText={setCategory}
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Audience</Text>
                <View style={styles.chipRow}>
                  {AUDIENCES.map((a) => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.chip, audience === a && styles.chipActive]}
                      onPress={() => setAudience(a)}
                    >
                      <Text style={[styles.chipText, audience === a && styles.chipTextActive]}>{a}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Content</Text>
                <TextInput
                  style={[styles.modalInput, styles.textArea]}
                  placeholder="Write the guide content..."
                  placeholderTextColor="#999"
                  value={body}
                  onChangeText={setBody}
                  multiline
                />
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>{editingId ? 'Save Changes' : 'Publish Article'}</Text>
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
  container: { flex: 1, backgroundColor: '#0F172A' },
  listContainer: { padding: 16, flexGrow: 1 },
  intro: { color: '#94A3B8', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  title: { color: '#F8FAFC', fontSize: 15, fontWeight: 'bold', flex: 1 },
  tagRow: { flexDirection: 'row', marginTop: 10 },
  categoryTag: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginRight: 8,
  },
  categoryTagText: { color: '#38BDF8', fontSize: 9, fontWeight: 'bold' },
  audienceTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  audienceTagText: { fontSize: 9, fontWeight: 'bold' },
  body: { color: '#94A3B8', fontSize: 14, lineHeight: 21, marginTop: 12 },
  actionRow: { flexDirection: 'row', marginTop: 14, borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 14 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderColor: '#38BDF8',
    borderWidth: 1,
    marginRight: 6,
  },
  editText: { color: '#38BDF8', fontWeight: '600', fontSize: 13 },
  deleteBtn: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    marginRight: 0,
    marginLeft: 6,
  },
  deleteText: { color: '#EF4444', fontWeight: '600', fontSize: 13 },
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
    elevation: 8,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCentered: { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 20 },
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
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { borderColor: '#38BDF8', backgroundColor: 'rgba(56, 189, 248, 0.1)' },
  chipText: { color: '#94A3B8', fontSize: 13, textTransform: 'capitalize' },
  chipTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
