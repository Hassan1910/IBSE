import React from 'react';
import { View, StyleSheet } from 'react-native';
import { adminTheme } from '../../constants/adminTheme';

function SkeletonBlock({ width, height, style }: { width?: number | `${number}%`; height: number; style?: object }) {
  return <View style={[styles.block, { width: width ?? '100%', height }, style]} />;
}

export default function DashboardSkeleton() {
  return (
    <View style={styles.container}>
      <SkeletonBlock height={24} width="60%" style={styles.mbSm} />
      <SkeletonBlock height={14} width="40%" style={styles.mbLg} />

      <View style={styles.statsGrid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.statSkeleton}>
            <SkeletonBlock height={32} width={32} style={styles.mbSm} />
            <SkeletonBlock height={10} width="50%" style={styles.mbSm} />
            <SkeletonBlock height={18} width="70%" />
          </View>
        ))}
      </View>

      <SkeletonBlock height={44} style={styles.mbLg} />

      <SkeletonBlock height={16} width="45%" style={styles.mbMd} />

      {[0, 1].map((i) => (
        <View key={i} style={styles.cardSkeleton}>
          <SkeletonBlock height={16} width="55%" style={styles.mbMd} />
          <SkeletonBlock height={28} width="35%" style={styles.mbMd} />
          <SkeletonBlock height={12} width="80%" style={styles.mbSm} />
          <SkeletonBlock height={12} width="65%" style={styles.mbMd} />
          <View style={styles.actionRow}>
            <SkeletonBlock height={44} style={{ flex: 1, marginRight: 8 }} />
            <SkeletonBlock height={44} style={{ flex: 1 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: adminTheme.spacing.lg,
  },
  block: {
    backgroundColor: adminTheme.colors.surfaceElevated,
    borderRadius: adminTheme.radius.sm,
    opacity: 0.6,
  },
  mbSm: { marginBottom: adminTheme.spacing.sm },
  mbMd: { marginBottom: adminTheme.spacing.md },
  mbLg: { marginBottom: adminTheme.spacing.lg },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -adminTheme.spacing.xs,
    marginBottom: adminTheme.spacing.lg,
  },
  statSkeleton: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: adminTheme.colors.surface,
    borderRadius: adminTheme.radius.lg,
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
    padding: adminTheme.spacing.md,
    margin: adminTheme.spacing.xs,
  },
  cardSkeleton: {
    backgroundColor: adminTheme.colors.surface,
    borderRadius: adminTheme.radius.lg,
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
    padding: adminTheme.spacing.lg,
    marginBottom: adminTheme.spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
  },
});
