import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

interface HelpArticle {
  id: string;
  title: string;
  category: string;
  audience: 'all' | 'staff' | 'tenant' | 'client';
  body: string;
}

export default function TenantHelpScreen() {
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchHelp = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const { data, error } = await supabase
        .from('help_articles')
        .select('id, title, category, audience, body')
        .in('audience', ['tenant', 'all'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      setArticles((data as HelpArticle[]) || []);
    } catch (err) {
      console.error('Fetch help articles error:', err);
      setLoadError(true);
      Alert.alert('Error', 'Failed to load help articles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHelp();
  }, [fetchHelp]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={articles}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContainer}
      renderItem={({ item }) => {
        const expanded = expandedId === item.id;
        return (
          <TouchableOpacity style={styles.card} onPress={() => setExpandedId(expanded ? null : item.id)} activeOpacity={0.85}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.category}>{item.category.toUpperCase()}</Text>
              </View>
              {expanded ? <ChevronUp size={18} color="#94A3B8" /> : <ChevronDown size={18} color="#94A3B8" />}
            </View>
            {expanded ? <Text style={styles.body}>{item.body}</Text> : null}
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>
            {loadError ? 'Could not load help articles. Please try again.' : 'No help articles are available right now.'}
          </Text>
          {loadError ? (
            <TouchableOpacity style={styles.retryBtn} onPress={() => void fetchHelp()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#0F172A' },
  listContainer: { padding: 16, backgroundColor: '#0F172A', flexGrow: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingTop: 40 },
  emptyText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
  retryBtn: {
    marginTop: 16,
    backgroundColor: '#38BDF8',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: { color: '#0F172A', fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155', padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  title: { color: '#F8FAFC', fontSize: 14, fontWeight: 'bold' },
  category: { color: '#38BDF8', marginTop: 4, fontSize: 11, fontWeight: '600' },
  body: { color: '#CBD5E1', marginTop: 10, lineHeight: 20, fontSize: 13 },
});
