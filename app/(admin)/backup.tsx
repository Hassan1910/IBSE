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
import { useUser } from '@clerk/clerk-expo';
import { useAudit } from '../../hooks/useAudit';
import { DatabaseBackup, HardDriveDownload, RotateCcw, ShieldCheck, Clock } from 'lucide-react-native';

interface Backup {
  id: string;
  label: string;
  status: 'completed' | 'restored' | 'failed';
  table_counts: Record<string, number>;
  total_records: number;
  notes: string | null;
  created_at: string;
}

// Tables included in a data snapshot.
const BACKED_UP_TABLES = [
  'profiles',
  'properties',
  'bookings',
  'leases',
  'payments',
  'maintenance_requests',
  'inventory',
  'feedback',
  'expenses',
];

export default function AdminBackupScreen() {
  const { user } = useUser();
  const { log } = useAudit();

  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchBackups = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('backups')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setBackups((data as Backup[]) || []);
    } catch (err) {
      console.error('Fetch backups error:', err);
      Alert.alert('Error', 'Failed to load backup history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const runBackup = async () => {
    try {
      setRunning(true);

      // Integrity snapshot: record counts only (not a full data dump).
      const counts: Record<string, number> = {};
      let total = 0;
      for (const table of BACKED_UP_TABLES) {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        if (error) throw error;
        counts[table] = count || 0;
        total += count || 0;
      }

      const label = `Snapshot ${new Date().toLocaleString('en-KE', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`;

      const { error: insertError } = await supabase.from('backups').insert({
        label,
        status: 'completed',
        table_counts: counts,
        total_records: total,
        notes: `Integrity check across ${BACKED_UP_TABLES.length} tables, ${total} records.`,
        created_by: user?.id ?? null,
      });
      if (insertError) throw insertError;

      log({ action: 'backup', entityType: 'system', description: `Created integrity snapshot (${total} records)` });
      Alert.alert(
        'Snapshot Saved',
        `Recorded counts for ${total} rows across ${BACKED_UP_TABLES.length} tables. This is an integrity checkpoint, not a downloadable database backup.`,
      );
      fetchBackups();
    } catch (err) {
      console.error('Run backup error:', err);
      Alert.alert('Error', 'Snapshot failed. Please try again.');
    } finally {
      setRunning(false);
    }
  };

  const logRecoveryEvent = (item: Backup) => {
    Alert.alert(
      'Log Recovery Event',
      `Record that you performed a recovery related to "${item.label}"? This does not restore data — use the Supabase dashboard for point-in-time recovery.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Event',
          onPress: async () => {
            try {
              const { error } = await supabase.from('backups').insert({
                label: `Recovery note: ${item.label}`,
                status: 'restored',
                table_counts: item.table_counts,
                total_records: item.total_records,
                notes: `Recovery accountability log referencing snapshot ${item.id}. Actual restore is done in Supabase.`,
                created_by: user?.id ?? null,
              });
              if (error) throw error;
              log({
                action: 'restore',
                entityType: 'system',
                entityId: item.id,
                description: `Logged recovery for ${item.label}`,
              });
              fetchBackups();
            } catch (err) {
              console.error('Restore log error:', err);
              Alert.alert('Error', 'Failed to record recovery event.');
            }
          },
        },
      ],
    );
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#10B981';
      case 'restored':
        return '#38BDF8';
      default:
        return '#EF4444';
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-KE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const renderHeader = () => (
    <View>
      <View style={styles.heroCard}>
        <ShieldCheck size={28} color="#38BDF8" />
        <Text style={styles.heroTitle}>Integrity Snapshots</Text>
        <Text style={styles.heroText}>
          Record row counts across core tables as an integrity checkpoint. This is not a full database
          dump — use the Supabase dashboard for real backups and point-in-time recovery.
        </Text>
        <TouchableOpacity style={styles.backupBtn} onPress={runBackup} disabled={running}>
          {running ? (
            <ActivityIndicator color="#0F172A" />
          ) : (
            <>
              <DatabaseBackup size={18} color="#0F172A" style={{ marginRight: 8 }} />
              <Text style={styles.backupBtnText}>Create Snapshot</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.listTitle}>Snapshot & Recovery Log</Text>
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
          data={backups}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.backupLabel}>{item.label}</Text>
                <View style={[styles.statusBadge, { borderColor: statusColor(item.status) }]}>
                  <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
                    {item.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <HardDriveDownload size={14} color="#94A3B8" style={{ marginRight: 6 }} />
                <Text style={styles.subText}>
                  {item.total_records} records • {Object.keys(item.table_counts || {}).length} tables
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Clock size={14} color="#94A3B8" style={{ marginRight: 6 }} />
                <Text style={styles.subText}>{formatDate(item.created_at)}</Text>
              </View>

              {item.status !== 'restored' && (
                <TouchableOpacity style={styles.restoreBtn} onPress={() => logRecoveryEvent(item)}>
                  <RotateCcw size={15} color="#38BDF8" style={{ marginRight: 6 }} />
                  <Text style={styles.restoreText}>Log recovery event</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          contentContainerStyle={styles.listContainer}
          onRefresh={fetchBackups}
          refreshing={loading}
          ListEmptyComponent={
            <View style={styles.emptyCentered}>
              <DatabaseBackup size={48} color="#94A3B8" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No snapshots yet. Create your first integrity checkpoint above.</Text>
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
  heroCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderColor: '#334155',
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 24,
  },
  heroTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: 'bold', marginTop: 10 },
  heroText: { color: '#94A3B8', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  backupBtn: {
    flexDirection: 'row',
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  backupBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 15 },
  listTitle: { fontSize: 16, fontWeight: 'bold', color: '#F8FAFC', marginBottom: 12 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  backupLabel: { color: '#F8FAFC', fontSize: 15, fontWeight: 'bold', flex: 1, marginRight: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: 'bold' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  subText: { color: '#94A3B8', fontSize: 13 },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#38BDF8',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 12,
  },
  restoreText: { color: '#38BDF8', fontWeight: '600', fontSize: 13 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCentered: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: '#94A3B8', fontSize: 14, textAlign: 'center' },
});
