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
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { UserPlus, X, Mail, Phone, Home, Calendar, Users } from 'lucide-react-native';

interface LeaseRow {
  id: string;
  tenant_id: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  status: 'active' | 'terminated' | 'expired';
  properties: { title: string } | null;
  profiles: { full_name: string; email: string; phone: string | null } | null;
}

interface TenantGroup {
  tenantId: string;
  fullName: string;
  email: string;
  phone: string | null;
  leases: LeaseRow[];
  activeCount: number;
}

export default function LandlordTenants() {
  const { user } = useUser();
  const [tenants, setTenants] = useState<TenantGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [submittingInvite, setSubmittingInvite] = useState(false);

  const fetchTenants = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('leases')
        .select('id, tenant_id, start_date, end_date, rent_amount, status, properties ( title ), profiles:tenant_id ( full_name, email, phone )')
        .eq('owner_id', user.id)
        .order('start_date', { ascending: false });

      if (error) throw error;

      const groups = new Map<string, TenantGroup>();
      for (const lease of (data as any as LeaseRow[]) || []) {
        if (!lease.tenant_id) continue;
        let group = groups.get(lease.tenant_id);
        if (!group) {
          group = {
            tenantId: lease.tenant_id,
            fullName: lease.profiles?.full_name || 'Unknown Tenant',
            email: lease.profiles?.email || '',
            phone: lease.profiles?.phone ?? null,
            leases: [],
            activeCount: 0,
          };
          groups.set(lease.tenant_id, group);
        }
        group.leases.push(lease);
        if (lease.status === 'active') group.activeCount += 1;
      }
      setTenants(Array.from(groups.values()));
    } catch (err) {
      console.error('Fetch tenants error:', err);
      Alert.alert('Error', 'Failed to load your tenants.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Validation Error', 'Please enter a valid email address.');
      return;
    }
    try {
      setSubmittingInvite(true);
      const { error } = await supabase.from('user_invites').upsert(
        {
          email,
          full_name: inviteName.trim() || null,
          role: 'tenant',
          status: 'pending',
          invited_by: user?.id ?? null,
        },
        { onConflict: 'email' },
      );
      if (error) throw error;

      logAudit({ actorId: user?.id || '', action: 'create', entityType: 'user_invite', description: `Invited tenant ${email}` });
      Alert.alert('Tenant Invited', `${email} is pre-registered as a tenant. When they sign up with this email, the role is applied automatically.`);
      setInviteModalVisible(false);
      setInviteEmail('');
      setInviteName('');
    } catch (err) {
      console.error('Invite tenant error:', err);
      Alert.alert('Error', 'Failed to create the tenant invite.');
    } finally {
      setSubmittingInvite(false);
    }
  };

  const formatPrice = (p: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(p);

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <>
          <FlatList
            data={tenants}
            keyExtractor={(item) => item.tenantId}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.name}>{item.fullName}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.activeCount} ACTIVE</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Mail size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>{item.email || 'No email'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Phone size={14} color="#38BDF8" style={styles.icon} />
                  <Text style={styles.infoText}>{item.phone || 'No phone number'}</Text>
                </View>

                <View style={styles.divider} />
                <Text style={styles.historyTitle}>Rental History</Text>
                {item.leases.map((l) => (
                  <View key={l.id} style={styles.historyRow}>
                    <Home size={13} color="#94A3B8" style={styles.icon} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyProp}>{l.properties?.title || 'Property'}</Text>
                      <View style={styles.historyMeta}>
                        <Calendar size={11} color="#64748B" style={{ marginRight: 4 }} />
                        <Text style={styles.historyDate}>
                          {formatDate(l.start_date)} - {formatDate(l.end_date)}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.historyRent}>{formatPrice(l.rent_amount)}</Text>
                      <Text
                        style={[
                          styles.historyStatus,
                          { color: l.status === 'active' ? '#10B981' : l.status === 'expired' ? '#EAB308' : '#EF4444' },
                        ]}
                      >
                        {l.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            contentContainerStyle={styles.listContainer}
            onRefresh={fetchTenants}
            refreshing={loading}
            ListEmptyComponent={
              <View style={styles.emptyCentered}>
                <Users size={48} color="#94A3B8" style={styles.emptyIcon} />
                <Text style={styles.emptyText}>No tenants yet. Create a rental agreement to add tenants.</Text>
              </View>
            }
          />

          <TouchableOpacity style={styles.fab} onPress={() => setInviteModalVisible(true)}>
            <UserPlus size={24} color="#0F172A" />
          </TouchableOpacity>
        </>
      )}

      <Modal animationType="slide" transparent visible={inviteModalVisible} onRequestClose={() => setInviteModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Tenant</Text>
              <TouchableOpacity onPress={() => setInviteModalVisible(false)}>
                <X size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inviteNote}>
                <Mail size={16} color="#38BDF8" style={{ marginRight: 8 }} />
                <Text style={styles.inviteNoteText}>
                  Pre-register a tenant by email. When they sign up with this email, they are automatically assigned the tenant role.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="name@domain.com"
                  placeholderTextColor="#999"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name (optional)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Jane Doe"
                  placeholderTextColor="#999"
                  value={inviteName}
                  onChangeText={setInviteName}
                  autoCapitalize="words"
                />
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleInvite} disabled={submittingInvite}>
                {submittingInvite ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.submitBtnText}>Send Invite</Text>
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
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  name: { fontSize: 16, fontWeight: 'bold', color: '#F8FAFC', flex: 1, marginRight: 8 },
  badge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { color: '#10B981', fontSize: 10, fontWeight: 'bold' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  icon: { marginRight: 8 },
  infoText: { color: '#94A3B8', fontSize: 13 },
  divider: { height: 1, backgroundColor: '#334155', marginVertical: 12 },
  historyTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: 'bold', marginBottom: 8 },
  historyRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  historyProp: { color: '#F8FAFC', fontSize: 13, fontWeight: '600' },
  historyMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  historyDate: { color: '#64748B', fontSize: 11 },
  historyRent: { color: '#38BDF8', fontSize: 13, fontWeight: 'bold' },
  historyStatus: { fontSize: 10, fontWeight: 'bold', marginTop: 2 },
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
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyCentered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, marginTop: 60 },
  emptyIcon: { marginBottom: 12 },
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
  inviteNote: {
    flexDirection: 'row',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  inviteNoteText: { color: '#94A3B8', fontSize: 12, lineHeight: 18, flex: 1 },
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
  submitBtn: { backgroundColor: '#38BDF8', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#0F172A', fontWeight: 'bold', fontSize: 16 },
});
