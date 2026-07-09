import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { adminTheme } from '../../constants/adminTheme';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  accentColor?: string;
}

export default function StatCard({
  label,
  value,
  icon: Icon,
  accentColor = adminTheme.colors.accent,
}: StatCardProps) {
  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      <View style={[styles.iconWrap, { backgroundColor: `${accentColor}18` }]}>
        <Icon size={18} color={accentColor} />
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: accentColor }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: adminTheme.colors.surface,
    borderRadius: adminTheme.radius.lg,
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
    borderLeftWidth: 3,
    padding: adminTheme.spacing.md,
    margin: adminTheme.spacing.xs,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: adminTheme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: adminTheme.spacing.sm,
  },
  label: {
    ...adminTheme.typography.label,
    color: adminTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: adminTheme.spacing.xs,
  },
  value: {
    fontSize: 18,
    fontWeight: '700',
  },
});
