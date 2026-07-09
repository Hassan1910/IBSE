import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAudit } from '../../hooks/useAudit';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  Home,
  Wallet,
  BedDouble,
  Users as UsersIcon,
  FileText,
} from 'lucide-react-native';

type ReportType = 'property' | 'financial' | 'occupancy' | 'users';

interface ReportRow {
  label: string;
  value: string;
  accent?: boolean;
}

interface ReportData {
  property: ReportRow[];
  financial: ReportRow[];
  occupancy: ReportRow[];
  users: ReportRow[];
}

const EMPTY: ReportData = { property: [], financial: [], occupancy: [], users: [] };

export default function AdminReportsScreen() {
  const { log } = useAudit();
  const [activeReport, setActiveReport] = useState<ReportType>('property');
  const [data, setData] = useState<ReportData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0,
    }).format(price);

  const buildReports = useCallback(async () => {
    try {
      setLoading(true);

      const [
        propsRes,
        leasesRes,
        paymentsRes,
        expensesRes,
        profilesRes,
        bookingsRes,
        maintenanceRes,
      ] = await Promise.all([
        supabase.from('properties').select('type, category, status'),
        supabase.from('leases').select('status'),
        supabase.from('payments').select('amount, status'),
        supabase.from('expenses').select('amount'),
        supabase.from('profiles').select('role, created_at'),
        supabase.from('bookings').select('status'),
        supabase.from('maintenance_requests').select('status'),
      ]);

      const properties = propsRes.data || [];
      const leases = leasesRes.data || [];
      const payments = paymentsRes.data || [];
      const expenses = expensesRes.data || [];
      const profiles = profilesRes.data || [];
      const bookings = bookingsRes.data || [];
      const maintenance = maintenanceRes.data || [];

      // ---- Property report ----
      const totalProps = properties.length;
      const available = properties.filter((p) => p.status === 'available').length;
      const rented = properties.filter((p) => p.status === 'rented').length;
      const sold = properties.filter((p) => p.status === 'sold').length;
      const residential = properties.filter((p) => p.category === 'residential').length;
      const commercial = properties.filter((p) => p.category === 'commercial').length;
      const land = properties.filter((p) => p.category === 'land').length;

      const property: ReportRow[] = [
        { label: 'Total Listings', value: String(totalProps), accent: true },
        { label: 'Available', value: String(available) },
        { label: 'Rented', value: String(rented) },
        { label: 'Sold', value: String(sold) },
        { label: 'Residential', value: String(residential) },
        { label: 'Commercial', value: String(commercial) },
        { label: 'Land', value: String(land) },
      ];

      // ---- Financial report ----
      const verifiedRevenue = payments
        .filter((p) => p.status === 'verified')
        .reduce((acc, p) => acc + Number(p.amount), 0);
      const pendingAmount = payments
        .filter((p) => p.status === 'pending')
        .reduce((acc, p) => acc + Number(p.amount), 0);
      const totalExpenses = expenses.reduce((acc, e) => acc + Number(e.amount), 0);
      const net = verifiedRevenue - totalExpenses;

      const financial: ReportRow[] = [
        { label: 'Verified Revenue', value: formatPrice(verifiedRevenue), accent: true },
        { label: 'Total Expenses', value: formatPrice(totalExpenses) },
        { label: 'Net Position', value: formatPrice(net), accent: true },
        { label: 'Pending Payments', value: formatPrice(pendingAmount) },
        { label: 'Payments Recorded', value: String(payments.length) },
      ];

      // ---- Occupancy report ----
      const rentalProps = properties.filter((p) => p.type === 'rental').length;
      const activeLeases = leases.filter((l) => l.status === 'active').length;
      const occupancyRate = rentalProps > 0 ? Math.round((rented / rentalProps) * 100) : 0;

      const occupancy: ReportRow[] = [
        { label: 'Occupancy Rate', value: `${occupancyRate}%`, accent: true },
        { label: 'Rental Units', value: String(rentalProps) },
        { label: 'Occupied Units', value: String(rented) },
        { label: 'Vacant Rentals', value: String(Math.max(0, rentalProps - rented)) },
        { label: 'Active Leases', value: String(activeLeases) },
        { label: 'Open Maintenance', value: String(maintenance.filter((m) => m.status !== 'resolved').length) },
      ];

      // ---- User activity report ----
      const byRole = (role: string) => profiles.filter((p) => p.role === role).length;
      const now = Date.now();
      const last30 = profiles.filter(
        (p) => p.created_at && now - new Date(p.created_at).getTime() < 30 * 24 * 60 * 60 * 1000,
      ).length;

      const users: ReportRow[] = [
        { label: 'Total Users', value: String(profiles.length), accent: true },
        { label: 'Admins', value: String(byRole('admin')) },
        { label: 'Finance Officers', value: String(byRole('finance')) },
        { label: 'Booking Officers', value: String(byRole('booking')) },
        { label: 'Tenants', value: String(byRole('tenant')) },
        { label: 'Clients', value: String(byRole('client')) },
        { label: 'New (30 days)', value: String(last30) },
        { label: 'Pending Bookings', value: String(bookings.filter((b) => b.status === 'pending').length) },
      ];

      setData({ property, financial, occupancy, users });
      setGeneratedAt(new Date());
    } catch (err) {
      console.error('Build reports error:', err);
      Alert.alert('Error', 'Failed to generate reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    buildReports();
  }, [buildReports]);

  const reportTabs: { key: ReportType; label: string; icon: any }[] = [
    { key: 'property', label: 'Property', icon: Home },
    { key: 'financial', label: 'Financial', icon: Wallet },
    { key: 'occupancy', label: 'Occupancy', icon: BedDouble },
    { key: 'users', label: 'Users', icon: UsersIcon },
  ];

  const rows = data[activeReport];

  const [exporting, setExporting] = useState(false);

  const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const handleExport = async () => {
    if (rows.length === 0) {
      Alert.alert('Nothing to Export', 'Generate the report first by refreshing.');
      return;
    }

    try {
      setExporting(true);

      const generatedLabel = (generatedAt || new Date()).toLocaleString('en-KE');
      const lines = [
        'Report,Metric,Value,Generated At',
        ...rows.map((r) =>
          [activeReport, r.label, r.value, generatedLabel].map(csvEscape).join(','),
        ),
      ];
      const csv = lines.join('\n');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = new File(Paths.cache, `ibsa-${activeReport}-report-${timestamp}.csv`);
      file.create();
      file.write(csv);

      log({ action: 'export', entityType: 'report', description: `Exported ${activeReport} report as CSV` });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: `${activeReport.charAt(0).toUpperCase() + activeReport.slice(1)} Report`,
        });
      } else {
        Alert.alert('Export Complete', `Report saved to:\n${file.uri}`);
      }
    } catch (err) {
      console.error('Export report error:', err);
      Alert.alert('Error', 'Failed to export the report.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={buildReports} tintColor="#38BDF8" />}
    >
      <Text style={styles.intro}>
        Generate live reports across properties, finances, occupancy, and user activity to support
        decision-making.
      </Text>

      <View style={styles.tabRow}>
        {reportTabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeReport === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              onPress={() => setActiveReport(tab.key)}
            >
              <Icon size={16} color={active ? '#38BDF8' : '#94A3B8'} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <View style={styles.card}>
          {rows.map((row, idx) => (
            <View key={row.label} style={[styles.row, idx === rows.length - 1 && styles.rowLast]}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={[styles.rowValue, row.accent && styles.rowValueAccent]}>{row.value}</Text>
            </View>
          ))}

          {generatedAt && (
            <Text style={styles.generatedText}>
              Generated {generatedAt.toLocaleString('en-KE')}
            </Text>
          )}

          <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <>
                <FileText size={18} color="#0F172A" style={{ marginRight: 8 }} />
                <Text style={styles.exportText}>Export as CSV</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 16, paddingBottom: 40 },
  intro: { color: '#94A3B8', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 4,
    marginBottom: 20,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 6,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: 'rgba(56, 189, 248, 0.2)',
    borderWidth: 1,
  },
  tabText: { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginLeft: 4 },
  tabTextActive: { color: '#38BDF8', fontWeight: 'bold' },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderColor: '#334155',
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { color: '#94A3B8', fontSize: 14 },
  rowValue: { color: '#F8FAFC', fontSize: 15, fontWeight: '600' },
  rowValueAccent: { color: '#38BDF8', fontWeight: 'bold', fontSize: 16 },
  generatedText: { color: '#64748B', fontSize: 11, marginTop: 14, textAlign: 'center' },
  exportBtn: {
    flexDirection: 'row',
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  exportText: { color: '#0F172A', fontWeight: 'bold', fontSize: 15 },
  centered: { padding: 40, alignItems: 'center', justifyContent: 'center' },
});
