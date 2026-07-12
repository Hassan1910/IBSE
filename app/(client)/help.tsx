import React, { useEffect, useState } from 'react';
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

export default function ClientHelpScreen() {
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const fetchHelp = async () => {
      try {
        setLoading(true);
        setLoadError(false);
        const { data, error } = await supabase
          .from('help_articles')
          .select('id, title, category, audience, body')
          .in('audience', ['client', 'all'])
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
    };
    fetchHelp();
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <FlatList
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
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {loadError ? 'Could not load help articles. Please try again later.' : 'No help articles are available right now.'}
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  listContainer: { padding: 16, paddingBottom: 40, flexGrow: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0F172A' },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  title: { color: '#F8FAFC', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  category: { color: '#38BDF8', fontSize: 11, fontWeight: '600' },
  body: { color: '#CBD5E1', fontSize: 14, lineHeight: 20, marginTop: 12 },
  emptyText: { color: '#94A3B8', textAlign: 'center', fontSize: 14 },
});
