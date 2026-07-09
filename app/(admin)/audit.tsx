import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import {
  LogIn,
  PlusCircle,
  Pencil,
  Trash2,
  Activity,
  ShieldAlert,
} from 'lucide-react-native';

interface AuditLog {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string | null;
  created_at: string;
}

type Filter = 'all' | 'login' | 'create' | 'update' | 'delete';

export default function AdminAuditScreen() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, actor_email, actor_role, action, entity_type, entity_id, description, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setLogs((data as AuditLog[]) || []);
    } catch (err) {
      console.error('Fetch audit logs error:', err);
      Alert.alert('Error', 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const visible = logs.filter((l) => (filter === 'all' ? true : l.action === filter));
  const loginCount = logs.filter((l) => l.action === 'login').length;
  const uniqueActors = new Set(logs.map((l) => l.actor_email).filter(Boolean)).size;

  const actionMeta = (action: string) => {
    switch (action) {
      case 'login':
        return { icon: LogIn, color: '#38BDF8' };
      case 'create':
        return { icon: PlusCircle, color: '#10B981' };
      case 'update':
      case 'reply':
        return { icon: Pencil, color: '#EAB308' };
      case 'delete':
        return { icon: Trash2, color: '#EF4444' };
      default:
        return { icon: Activity, color: '#94A3B8' };
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-KE', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const renderHeader = () => (
    <View>
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Events</Text>
          <Text style={styles.statVal}>{logs.length}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Logins</Text>
          <Text style={styles.statVal}>{loginCount}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Active Users</Text>
          <Text style={styles.statVal}>{uniqueActors}</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'login', 'create', 'update', 'delete'] as Filter[]).map((f) => (
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
            const meta = actionMeta(item.action);
            const Icon = meta.icon;
            return (
              <View style={styles.logRow}>
                <View style={[styles.iconWrap, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}>
                  <Icon size={16} color={meta.color} />
                </View>
                <View style={styles.logInfo}>
                  <Text style={styles.logDesc}>
                    {item.description ||
                      `${item.action}${item.entity_type ? ` ${item.entity_type}` : ''}`}
                  </Text>
                  <Text style={styles.logActor}>
                    {item.actor_email || 'Unknown'}
                    {item.actor_role ? ` • ${item.actor_role}` : ''}
                  </Text>
                  <Text style={styles.logDate}>{formatDate(item.created_at)}</Text>
                </View>
                <View style={[styles.actionTag, { borderColor: meta.color }]}>
                  <Text style={[styles.actionTagText, { color: meta.color }]}>
                    {item.action.toUpperCase()}
                  </Text>
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchLogs}
          refreshing={loading}
          ListEmptyComponent={
            <View style={styles.emptyCentered}>
              <ShieldAlert size={48} color="#94A3B8" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>
                No {filter === 'all' ? '' : filter} activity recorded yet.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  listContainer: { padding: 16 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  statBox: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statLabel: { color: '#94A3B8', fontSize: 11, marginBottom: 4 },
  statVal: { color: '#38BDF8', fontSize: 18, fontWeight: 'bold' },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 4,
    marginBottom: 16,
  },
  filterBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  filterBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: 'rgba(56, 189, 248, 0.2)',
    borderWidth: 1,
  },
  filterText: { color: '#94A3B8', fontSize: 10, fontWeight: '600' },
  filterTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderColor: '#334155',
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginRight: 12,
  },
  logInfo: { flex: 1 },
  logDesc: { color: '#F8FAFC', fontSize: 14, fontWeight: '600' },
  logActor: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  logDate: { color: '#64748B', fontSize: 11, marginTop: 2 },
  actionTag: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, borderWidth: 1, marginLeft: 8 },
  actionTagText: { fontSize: 9, fontWeight: 'bold' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCentered: { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 40 },
  emptyText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
});
