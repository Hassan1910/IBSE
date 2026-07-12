import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
} from 'react-native';
import { useAudit } from '../../hooks/useAudit';
import { useAdminReportSummary } from '../../hooks/queries/useDashboard';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import DatePickerModal from '../../components/DatePickerModal';
import {
  Home,
  Wallet,
  BedDouble,
  Users as UsersIcon,
  FileText,
  Calendar,
} from 'lucide-react-native';

type ReportType = 'property' | 'financial' | 'occupancy' | 'users';

interface ReportRow {
  label: string;
  value: string;
  accent?: boolean;
}

function todayISO() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function isUserCancellation(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /cancel|dismiss|abort/i.test(message);
}

function downloadCsvWeb(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function AdminReportsScreen() {
  const { log } = useAudit();
  const [activeReport, setActiveReport] = useState<ReportType>('property');
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [fromPicker, setFromPicker] = useState(false);
  const [toPicker, setToPicker] = useState(false);
  const { data: summary, isLoading, isRefetching, refetch, dataUpdatedAt, isError } =
    useAdminReportSummary(fromDate, toDate);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      maximumFractionDigits: 0,
    }).format(price);

  const data = useMemo(() => {
    if (!summary) {
      return { property: [] as ReportRow[], financial: [] as ReportRow[], occupancy: [] as ReportRow[], users: [] as ReportRow[] };
    }

    const rented = summary.property.rented;
    const rentalUnits = summary.property.rental_units;
    const occupancyRate = rentalUnits > 0 ? Math.round((rented / rentalUnits) * 100) : 0;
    const net = Number(summary.financial.verified_revenue) - Number(summary.financial.total_expenses);

    return {
      property: [
        { label: 'Total Listings', value: String(summary.property.total), accent: true },
        { label: 'Available', value: String(summary.property.available) },
        { label: 'Rented', value: String(summary.property.rented) },
        { label: 'Sold', value: String(summary.property.sold) },
        { label: 'Residential', value: String(summary.property.residential) },
        { label: 'Commercial', value: String(summary.property.commercial) },
        { label: 'Land', value: String(summary.property.land) },
      ],
      financial: [
        {
          label: 'Verified Revenue',
          value: formatPrice(Number(summary.financial.verified_revenue)),
          accent: true,
        },
        { label: 'Total Expenses', value: formatPrice(Number(summary.financial.total_expenses)) },
        { label: 'Net Position', value: formatPrice(net), accent: true },
        {
          label: 'Pending Payments',
          value: formatPrice(Number(summary.financial.pending_amount)),
        },
        { label: 'Payments Recorded', value: String(summary.financial.payments_count) },
      ],
      occupancy: [
        { label: 'Occupancy Rate', value: `${occupancyRate}%`, accent: true },
        { label: 'Rental Units', value: String(rentalUnits) },
        { label: 'Occupied Units', value: String(rented) },
        { label: 'Vacant Rentals', value: String(Math.max(0, rentalUnits - rented)) },
        { label: 'Active Leases', value: String(summary.occupancy.active_leases) },
        { label: 'Open Maintenance', value: String(summary.occupancy.open_maintenance) },
      ],
      users: [
        { label: 'Total Users', value: String(summary.users.total), accent: true },
        { label: 'Admins', value: String(summary.users.admin) },
        { label: 'Finance Officers', value: String(summary.users.finance) },
        { label: 'Landlords', value: String(summary.users.landlord) },
        { label: 'Tenants', value: String(summary.users.tenant) },
        { label: 'Clients', value: String(summary.users.client) },
        { label: 'New (30 days)', value: String(summary.users.new_30_days) },
      ],
    };
  }, [summary]);

  const reportTabs: { key: ReportType; label: string; icon: any }[] = [
    { key: 'property', label: 'Property', icon: Home },
    { key: 'financial', label: 'Financial', icon: Wallet },
    { key: 'occupancy', label: 'Occupancy', icon: BedDouble },
    { key: 'users', label: 'Users', icon: UsersIcon },
  ];

  const rows = data[activeReport];
  const generatedAt = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const [exporting, setExporting] = useState(false);

  const buildCsv = () => {
    const generatedLabel = (generatedAt || new Date()).toLocaleString('en-KE');
    const rangeLabel = fromDate || toDate ? `${fromDate || '…'} to ${toDate || '…'}` : 'All time';
    const lines = [
      'Report,Metric,Value,Date Range,Generated At',
      ...rows.map((r) =>
        [activeReport, r.label, r.value, rangeLabel, generatedLabel].map(csvEscape).join(','),
      ),
    ];
    return lines.join('\n');
  };

  const exportFilename = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `ibsa-${activeReport}-report-${timestamp}.csv`;
  };

  const logExport = () => {
    log({
      action: 'export',
      entityType: 'report',
      description: `Exported ${activeReport} report as CSV`,
    });
  };

  const saveCsvToDevice = async (csv: string, filename: string) => {
    if (Platform.OS === 'web') {
      downloadCsvWeb(filename, csv);
      logExport();
      Alert.alert('Download started', 'Your CSV download should begin shortly.');
      return;
    }

    const directory = await Directory.pickDirectoryAsync();
    const file = directory.createFile(filename, 'text/csv');
    file.write(csv);
    logExport();
    Alert.alert('Saved', 'Report saved to the selected folder.');
  };

  const shareCsv = async (csv: string, filename: string) => {
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true });
    file.write(csv);
    logExport();

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: `${activeReport.charAt(0).toUpperCase() + activeReport.slice(1)} Report`,
      });
      return;
    }

    Alert.alert('Export Complete', `Report saved to:\n${file.uri}`);
  };

  const runExportAction = async (action: 'save' | 'share') => {
    try {
      setExporting(true);
      const csv = buildCsv();
      const filename = exportFilename();
      if (action === 'save') {
        await saveCsvToDevice(csv, filename);
      } else {
        await shareCsv(csv, filename);
      }
    } catch (err) {
      if (isUserCancellation(err)) return;
      console.error('Export report error:', err);
      Alert.alert('Error', 'Failed to export the report.');
    } finally {
      setExporting(false);
    }
  };

  const handleExport = () => {
    if (rows.length === 0) {
      Alert.alert('Nothing to Export', 'Generate the report first by refreshing.');
      return;
    }

    Alert.alert('Export CSV', 'Choose how to export this report.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Share', onPress: () => void runExportAction('share') },
      { text: 'Save to device', onPress: () => void runExportAction('save') },
    ]);
  };

  const loading = isLoading && !summary;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#38BDF8" />
      }
    >
      <Text style={styles.intro}>
        Generate live reports across properties, finances, occupancy, and user activity. Date filters
        apply to financial payment and expense totals.
      </Text>

      <View style={styles.filters}>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setFromPicker(true)}>
          <Calendar size={14} color="#38BDF8" />
          <Text style={styles.dateBtnText}>{fromDate ? `From ${fromDate}` : 'From (all)'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setToPicker(true)}>
          <Calendar size={14} color="#38BDF8" />
          <Text style={styles.dateBtnText}>{toDate ? `To ${toDate}` : 'To (all)'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.presetRow}>
        <TouchableOpacity
          style={styles.preset}
          onPress={() => {
            setFromDate(null);
            setToDate(null);
          }}
        >
          <Text style={styles.presetText}>All time</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.preset}
          onPress={() => {
            setFromDate(daysAgoISO(30));
            setToDate(todayISO());
          }}
        >
          <Text style={styles.presetText}>30d</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.preset}
          onPress={() => {
            setFromDate(daysAgoISO(90));
            setToDate(todayISO());
          }}
        >
          <Text style={styles.presetText}>90d</Text>
        </TouchableOpacity>
      </View>

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
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to generate reports.</Text>
          <TouchableOpacity style={styles.exportBtn} onPress={() => refetch()}>
            <Text style={styles.exportText}>Retry</Text>
          </TouchableOpacity>
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

      <DatePickerModal
        visible={fromPicker}
        onClose={() => setFromPicker(false)}
        value={fromDate || todayISO()}
        onChange={(d) => {
          if (toDate && d > toDate) {
            Alert.alert('Invalid Range', 'From date cannot be after To date.');
            return;
          }
          setFromDate(d);
          setFromPicker(false);
        }}
        title="From date"
      />
      <DatePickerModal
        visible={toPicker}
        onClose={() => setToPicker(false)}
        value={toDate || todayISO()}
        onChange={(d) => {
          if (fromDate && d < fromDate) {
            Alert.alert('Invalid Range', 'To date cannot be before From date.');
            return;
          }
          setToDate(d);
          setToPicker(false);
        }}
        title="To date"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 16, paddingBottom: 40 },
  intro: { color: '#94A3B8', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
  },
  dateBtnText: { color: '#CBD5E1', fontSize: 12, fontWeight: '600' },
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  preset: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(56,189,248,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.25)',
  },
  presetText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
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
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { color: '#94A3B8', fontSize: 14 },
  rowValue: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  rowValueAccent: { color: '#38BDF8' },
  generatedText: { color: '#64748B', fontSize: 11, marginTop: 8, marginBottom: 12 },
  exportBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  exportText: { color: '#0F172A', fontWeight: '700', fontSize: 14 },
  centered: { paddingVertical: 40, alignItems: 'center' },
  errorText: { color: '#EF4444', marginBottom: 12 },
});
