import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type ViewStyle } from 'react-native';
import { adminTheme } from '../../constants/adminTheme';

interface BadgeConfig {
  label: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
}

interface QueueCardProps {
  title: string;
  badge?: BadgeConfig;
  accentColor?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  style?: ViewStyle;
}

export default function QueueCard({
  title,
  badge,
  accentColor = adminTheme.colors.accent,
  children,
  actions,
  footer,
  style,
}: QueueCardProps) {
  return (
    <View style={[styles.card, { borderLeftColor: accentColor }, style]}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {badge ? (
          <View
            style={[
              styles.badge,
              {
                backgroundColor: badge.backgroundColor ?? adminTheme.colors.accentMuted,
                borderColor: badge.borderColor ?? adminTheme.colors.accent,
              },
            ]}
          >
            <Text style={[styles.badgeText, { color: badge.textColor ?? adminTheme.colors.accent }]}>
              {badge.label}
            </Text>
          </View>
        ) : null}
      </View>

      {children}

      {actions ? <View style={styles.actions}>{actions}</View> : null}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

export function QueueCardDivider() {
  return <View style={styles.divider} />;
}

export function QueueCardInfoRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.infoRow}>
      {icon}
      <View style={styles.infoContent}>{children}</View>
    </View>
  );
}

export function QueueCardActionButton({
  label,
  onPress,
  variant = 'outline',
  icon,
  flex = 1,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'danger';
  icon?: React.ReactNode;
  flex?: number;
}) {
  const variantStyles = {
    primary: {
      btn: styles.btnPrimary,
      text: styles.btnPrimaryText,
    },
    outline: {
      btn: styles.btnOutline,
      text: styles.btnOutlineText,
    },
    danger: {
      btn: styles.btnDanger,
      text: styles.btnDangerText,
    },
  }[variant];

  return (
    <TouchableOpacity
      style={[styles.actionBtn, variantStyles.btn, { flex }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {icon}
      <Text style={[styles.actionText, variantStyles.text]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: adminTheme.colors.surface,
    borderRadius: adminTheme.radius.lg,
    padding: adminTheme.spacing.lg,
    marginBottom: adminTheme.spacing.lg,
    borderWidth: 1,
    borderColor: adminTheme.colors.border,
    borderLeftWidth: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: adminTheme.spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: adminTheme.colors.textMuted,
    marginRight: adminTheme.spacing.sm,
  },
  badge: {
    paddingHorizontal: adminTheme.spacing.sm,
    paddingVertical: adminTheme.spacing.xs,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: adminTheme.colors.border,
    marginVertical: adminTheme.spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  infoContent: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: adminTheme.spacing.sm,
    gap: adminTheme.spacing.sm,
  },
  footer: {
    marginTop: adminTheme.spacing.md,
    paddingTop: adminTheme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: adminTheme.colors.border,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: adminTheme.radius.sm,
  },
  actionText: {
    fontWeight: '700',
    fontSize: 13,
  },
  btnPrimary: {
    backgroundColor: adminTheme.colors.accent,
  },
  btnPrimaryText: {
    color: adminTheme.colors.onAccent,
  },
  btnOutline: {
    borderColor: adminTheme.colors.accent,
    borderWidth: 1,
  },
  btnOutlineText: {
    color: adminTheme.colors.accent,
  },
  btnDanger: {
    borderColor: adminTheme.colors.danger,
    borderWidth: 1,
  },
  btnDangerText: {
    color: adminTheme.colors.danger,
  },
});
