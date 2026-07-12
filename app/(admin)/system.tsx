import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useRole } from '../../hooks/useRole';
import { adminTheme } from '../../constants/adminTheme';
import {
  FileBarChart,
  Wallet,
  MessageSquare,
  ScrollText,
  Settings,
  DatabaseBackup,
  GraduationCap,
  ChevronRight,
} from 'lucide-react-native';

interface Tool {
  route: Href;
  title: string;
  description: string;
  icon: any;
  financeAllowed: boolean;
}

const TOOLS: Tool[] = [
  {
    route: '/(admin)/reports',
    title: 'Report Generation',
    description: 'Property, financial, occupancy & user reports',
    icon: FileBarChart,
    financeAllowed: true,
  },
  {
    route: '/(admin)/finances',
    title: 'Financial Oversight',
    description: 'Track revenue, expenses & net position',
    icon: Wallet,
    financeAllowed: true,
  },
  {
    route: '/(admin)/support',
    title: 'Feedback & Support',
    description: 'Respond to complaints and user inquiries',
    icon: MessageSquare,
    financeAllowed: false,
  },
  {
    route: '/(admin)/audit',
    title: 'Monitoring & Auditing',
    description: 'System logs and login activity trail',
    icon: ScrollText,
    financeAllowed: false,
  },
  {
    route: '/(admin)/settings',
    title: 'System Configuration',
    description: 'Manage app settings and maintenance mode',
    icon: Settings,
    financeAllowed: false,
  },
  {
    route: '/(admin)/backup',
    title: 'Integrity Snapshots',
    description: 'Record table row counts; real restores use the Supabase dashboard',
    icon: DatabaseBackup,
    financeAllowed: false,
  },
  {
    route: '/(admin)/training',
    title: 'Training & Support Content',
    description: 'Publish guides for staff, tenants & clients',
    icon: GraduationCap,
    financeAllowed: false,
  },
];

export default function AdminSystemHub() {
  const router = useRouter();
  const { role } = useRole();
  const isFinance = role === 'finance';

  const tools = isFinance ? TOOLS.filter((t) => t.financeAllowed) : TOOLS;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Administrative tools for reporting, finance, auditing, configuration, and support.
      </Text>

      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <TouchableOpacity
            key={tool.title}
            style={styles.card}
            onPress={() => router.push(tool.route)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Icon size={22} color={adminTheme.colors.accent} />
            </View>
            <View style={styles.textWrap}>
              <Text style={styles.cardTitle}>{tool.title}</Text>
              <Text style={styles.cardDesc}>{tool.description}</Text>
            </View>
            <ChevronRight size={20} color={adminTheme.colors.textMuted} />
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: adminTheme.colors.bg },
  content: { padding: adminTheme.spacing.lg, paddingBottom: 40 },
  intro: {
    color: adminTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: adminTheme.spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: adminTheme.colors.surface,
    borderRadius: adminTheme.radius.lg,
    padding: adminTheme.spacing.lg,
    marginBottom: adminTheme.spacing.md,
    borderColor: adminTheme.colors.border,
    borderWidth: 1,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: adminTheme.radius.md,
    backgroundColor: adminTheme.colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  textWrap: { flex: 1 },
  cardTitle: { color: adminTheme.colors.text, fontSize: 15, fontWeight: '700' },
  cardDesc: { color: adminTheme.colors.textMuted, fontSize: 12, marginTop: 3, lineHeight: 17 },
});
