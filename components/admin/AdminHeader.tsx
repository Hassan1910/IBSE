import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { adminTheme } from '../../constants/adminTheme';

interface AdminHeaderProps {
  title?: string;
  subtitle?: string;
  badgeCount?: number;
}

/** Optional supplementary header content rendered below the drawer navigation header. */
export default function AdminHeader({ title, subtitle, badgeCount }: AdminHeaderProps) {
  if (!title && !subtitle) return null;

  return (
    <View style={styles.container}>
      <View style={styles.textWrap}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {badgeCount !== undefined && badgeCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: adminTheme.spacing.lg,
    paddingVertical: adminTheme.spacing.md,
    backgroundColor: adminTheme.colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: adminTheme.colors.border,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    ...adminTheme.typography.subtitle,
    color: adminTheme.colors.text,
  },
  subtitle: {
    ...adminTheme.typography.caption,
    color: adminTheme.colors.textMuted,
    marginTop: 2,
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: adminTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: adminTheme.colors.onAccent,
  },
});
