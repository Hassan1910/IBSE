import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { ChevronRight, MessageSquare } from 'lucide-react-native';
import LeaseMessagesPanel from '../../components/LeaseMessagesPanel';
import { supabase } from '../../lib/supabase';

type ConversationRow = {
  id: string;
  status: string;
  start_date: string;
  tenantName: string;
  propertyTitle: string;
  lastActivity: string | null;
};

export default function LandlordMessagesScreen() {
  const { user } = useUser();
  const router = useRouter();
  const params = useLocalSearchParams<{ leaseId?: string; id?: string }>();
  const selectedLeaseId = (params.leaseId || params.id || null) as string | null;

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('leases')
        .select(
          `
          id,
          status,
          start_date,
          properties!inner ( title, owner_id ),
          profiles:tenant_id ( full_name ),
          message_threads ( id, updated_at )
        `
        )
        .eq('properties.owner_id', user.id)
        .in('status', ['pending', 'active']);
      if (error) throw error;

      const rows: ConversationRow[] = ((data as any[]) || []).map((lease) => {
        const thread = Array.isArray(lease.message_threads)
          ? lease.message_threads[0]
          : lease.message_threads;
        return {
          id: lease.id,
          status: lease.status,
          start_date: lease.start_date,
          tenantName: lease.profiles?.full_name || 'Tenant',
          propertyTitle: lease.properties?.title || 'Property',
          lastActivity: thread?.updated_at || null,
        };
      });

      rows.sort((a, b) => {
        const aTime = a.lastActivity || a.start_date || '';
        const bTime = b.lastActivity || b.start_date || '';
        return bTime.localeCompare(aTime);
      });

      setConversations(rows);
    } catch (err) {
      console.error('Load conversations error:', err);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!selectedLeaseId) void loadConversations();
    }, [selectedLeaseId, loadConversations])
  );

  if (selectedLeaseId) {
    return <LeaseMessagesPanel role="landlord" leaseId={selectedLeaseId} />;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <Text style={styles.headerHint}>Choose a tenant lease to open the conversation</Text>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={loadConversations}
        refreshing={loading}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <MessageSquare size={40} color="#64748B" />
            <Text style={styles.empty}>
              No active or pending leases to message. Assign a lease to a tenant first.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() =>
              router.push({ pathname: '/(landlord)/messages', params: { leaseId: item.id } })
            }
          >
            <View style={styles.rowBody}>
              <Text style={styles.tenantName}>{item.tenantName}</Text>
              <Text style={styles.propertyTitle}>{item.propertyTitle}</Text>
              <Text style={styles.meta}>
                {item.status === 'pending' ? 'PENDING' : 'ACTIVE'}
                {item.lastActivity
                  ? ` · ${new Date(item.lastActivity).toLocaleString('en-KE', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ' · No messages yet'}
              </Text>
            </View>
            <ChevronRight size={18} color="#94A3B8" />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '700' },
  headerHint: { color: '#64748B', fontSize: 12, marginTop: 2 },
  list: { padding: 16, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    marginBottom: 10,
  },
  rowBody: { flex: 1, marginRight: 8 },
  tenantName: { color: '#F8FAFC', fontSize: 15, fontWeight: '700' },
  propertyTitle: { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  meta: { color: '#64748B', fontSize: 11, marginTop: 4 },
  emptyWrap: { alignItems: 'center', marginTop: 48, paddingHorizontal: 24 },
  empty: { color: '#94A3B8', textAlign: 'center', marginTop: 12, lineHeight: 20 },
});
