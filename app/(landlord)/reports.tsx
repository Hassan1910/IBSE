import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '../../lib/supabase';
import DatePickerModal from '../../components/DatePickerModal';
import { Calendar, Wallet, BedDouble } from 'lucide-react-native';

type LandlordReport = {
  income: {
    verified_collected: number;
    pending_amount: number;
    payments_count: number;
  };
  occupancy: {
    total_properties: number;
    active_leases: number;
    pending_leases: number;
    occupied_units: number;
    vacant_units: number;
  };
};

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

export default function LandlordReportsScreen() {
  const { user } = useUser();
  const [fromDate, setFromDate] = useState(daysAgoISO(30));
  const [toDate, setToDate] = useState(todayISO());
  const [fromPicker, setFromPicker] = useState(false);
  const [toPicker, setToPicker] = useState(false);

  const reportQuery = useQuery({
    queryKey: ['landlord', 'reports', user?.id, fromDate, toDate],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('landlord_report_summary', {
        p_owner_id: user!.id,
        p_from: fromDate || null,
        p_to: toDate || null,
      });
      if (error) throw error;
      return data as LandlordReport;
    },
  });

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(price);

  const incomeRows = useMemo(() => {
    const income = reportQuery.data?.income;
    if (!income) return [];
    return [
      { label: 'Verified collected', value: formatPrice(Number(income.verified_collected)), accent: true },
      { label: 'Pending amount', value: formatPrice(Number(income.pending_amount)) },
      { label: 'Payments recorded', value: String(income.payments_count) },
    ];
  }, [reportQuery.data]);

  const occupancyRows = useMemo(() => {
    const occ = reportQuery.data?.occupancy;
    if (!occ) return [];
    return [
      { label: 'Properties', value: String(occ.total_properties), accent: true },
      { label: 'Active leases', value: String(occ.active_leases) },
      { label: 'Pending leases', value: String(occ.pending_leases) },
      { label: 'Occupied units', value: String(occ.occupied_units) },
      { label: 'Vacant units', value: String(occ.vacant_units) },
    ];
  }, [reportQuery.data]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={reportQuery.isRefetching && !reportQuery.isLoading}
          onRefresh={() => reportQuery.refetch()}
          tintColor="#38BDF8"
        />
      }
    >
      <Text style={styles.title}>Income & Occupancy</Text>
      <Text style={styles.hint}>Filter income by payment date range. Occupancy is current snapshot.</Text>

      <View style={styles.filters}>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setFromPicker(true)}>
          <Calendar size={14} color="#38BDF8" />
          <Text style={styles.dateBtnText}>From {fromDate}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setToPicker(true)}>
          <Calendar size={14} color="#38BDF8" />
          <Text style={styles.dateBtnText}>To {toDate}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.presetRow}>
        {[
          { label: '30d', from: daysAgoISO(30) },
          { label: '90d', from: daysAgoISO(90) },
          { label: 'YTD', from: `${new Date().getFullYear()}-01-01` },
        ].map((p) => (
          <TouchableOpacity
            key={p.label}
            style={styles.preset}
            onPress={() => {
              setFromDate(p.from);
              setToDate(todayISO());
            }}
          >
            <Text style={styles.presetText}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {reportQuery.isLoading && !reportQuery.data ? (
        <ActivityIndicator color="#38BDF8" style={{ marginTop: 40 }} />
      ) : reportQuery.isError ? (
        <Text style={styles.error}>Failed to load report. Pull to refresh.</Text>
      ) : (
        <>
          <View style={styles.sectionHeader}>
            <Wallet size={16} color="#38BDF8" />
            <Text style={styles.sectionTitle}>Income</Text>
          </View>
          {incomeRows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={[styles.rowValue, row.accent && styles.accent]}>{row.value}</Text>
            </View>
          ))}

          <View style={[styles.sectionHeader, { marginTop: 20 }]}>
            <BedDouble size={16} color="#38BDF8" />
            <Text style={styles.sectionTitle}>Occupancy</Text>
          </View>
          {occupancyRows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={[styles.rowValue, row.accent && styles.accent]}>{row.value}</Text>
            </View>
          ))}
        </>
      )}

      <DatePickerModal
        visible={fromPicker}
        onClose={() => setFromPicker(false)}
        value={fromDate}
        onChange={(d) => {
          setFromDate(d);
          setFromPicker(false);
        }}
        title="From date"
      />
      <DatePickerModal
        visible={toPicker}
        onClose={() => setToPicker(false)}
        value={toDate}
        onChange={(d) => {
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
  content: { padding: 20, paddingBottom: 40 },
  title: { color: '#F8FAFC', fontSize: 20, fontWeight: '700', marginBottom: 6 },
  hint: { color: '#64748B', fontSize: 12, lineHeight: 17, marginBottom: 14 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 10 },
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
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  preset: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(56,189,248,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.25)',
  },
  presetText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowLabel: { color: '#94A3B8', fontSize: 13 },
  rowValue: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  accent: { color: '#38BDF8' },
  error: { color: '#EF4444', marginTop: 24, textAlign: 'center' },
});
