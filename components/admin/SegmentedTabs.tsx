import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { adminTheme } from '../../constants/adminTheme';

export interface SegmentedTabItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

interface SegmentedTabsProps {
  tabs: SegmentedTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export default function SegmentedTabs({ tabs, activeKey, onChange }: SegmentedTabsProps) {
  if (tabs.length <= 1) return null;

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = activeKey === tab.key;
        const Icon = tab.icon;
        const color = isActive ? adminTheme.colors.accent : adminTheme.colors.textMuted;

        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.7}
          >
            {Icon ? <Icon size={13} color={color} style={styles.icon} /> : null}
            <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
            {tab.count !== undefined && tab.count > 0 ? (
              <View style={[styles.badge, isActive && styles.badgeActive]}>
                <Text style={[styles.badgeText, isActive && styles.badgeTextActive]}>
                  {tab.count}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: adminTheme.colors.surface,
    borderRadius: adminTheme.radius.md,
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
    padding: adminTheme.spacing.xs,
    marginBottom: adminTheme.spacing.lg,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: adminTheme.radius.sm,
  },
  tabActive: {
    backgroundColor: adminTheme.colors.accentMuted,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  icon: {
    marginRight: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: adminTheme.colors.textMuted,
  },
  labelActive: {
    color: adminTheme.colors.accent,
    fontWeight: '700',
  },
  badge: {
    marginLeft: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: adminTheme.colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeActive: {
    backgroundColor: adminTheme.colors.accent,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: adminTheme.colors.textMuted,
  },
  badgeTextActive: {
    color: adminTheme.colors.onAccent,
  },
});
