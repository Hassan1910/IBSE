import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import {
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { useRouter, usePathname } from 'expo-router';
import { useUser, useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut, Shield } from 'lucide-react-native';
import { adminTheme } from '../../constants/adminTheme';
import {
  ADMIN_NAV_SECTIONS,
  getNavItemsForRole,
  type AdminNavItem,
} from '../../lib/adminNav';
import { useRole } from '../../hooks/useRole';

export default function AdminDrawerContent(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { signOut } = useAuth();
  const { role } = useRole();

  const isFinance = role === 'finance';
  const navItems = getNavItemsForRole(isFinance);
  const accountLabel = isFinance ? 'Finance Staff' : 'Administrator';

  const activeRoute = pathname.split('/').filter(Boolean).pop() ?? 'dashboard';

  const navigateTo = (item: AdminNavItem) => {
    router.push(`/(admin)/${item.name}` as any);
    props.navigation.closeDrawer();
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const firstName = user?.firstName || user?.fullName?.split(' ')[0] || 'Admin';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.brand}>
        <View style={styles.brandIcon}>
          <Shield size={22} color={adminTheme.colors.onAccent} />
        </View>
        <View>
          <Text style={styles.brandTitle}>IBSE Admin</Text>
          <Text style={styles.brandSubtitle}>Property Management</Text>
        </View>
      </View>

      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {ADMIN_NAV_SECTIONS.map((section) => {
          const sectionItems = navItems.filter((item) => item.section === section.key);
          if (sectionItems.length === 0) return null;

          return (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              {sectionItems.map((item) => {
                const isActive = activeRoute === item.name;
                const Icon = item.icon;

                return (
                  <TouchableOpacity
                    key={item.name}
                    style={[styles.navItem, isActive && styles.navItemActive]}
                    onPress={() => navigateTo(item)}
                    activeOpacity={0.7}
                  >
                    {isActive ? <View style={styles.activeIndicator} /> : null}
                    <Icon
                      size={18}
                      color={isActive ? adminTheme.colors.accent : adminTheme.colors.textMuted}
                    />
                    <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </DrawerContentScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + adminTheme.spacing.md }]}>
        <View style={styles.userRow}>
          {user?.imageUrl ? (
            <Image source={{ uri: user.imageUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{firstName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>
              {user?.fullName || firstName}
            </Text>
            <Text style={styles.userRole}>{accountLabel}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
          <LogOut size={16} color={adminTheme.colors.danger} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: adminTheme.colors.surface,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: adminTheme.spacing.lg,
    paddingVertical: adminTheme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: adminTheme.colors.border,
  },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: adminTheme.radius.md,
    backgroundColor: adminTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: adminTheme.spacing.md,
  },
  brandTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: adminTheme.colors.text,
  },
  brandSubtitle: {
    fontSize: 11,
    color: adminTheme.colors.textMuted,
    marginTop: 1,
  },
  scrollContent: {
    paddingTop: adminTheme.spacing.sm,
    paddingBottom: adminTheme.spacing.lg,
  },
  section: {
    marginBottom: adminTheme.spacing.md,
  },
  sectionLabel: {
    ...adminTheme.typography.label,
    color: adminTheme.colors.textDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: adminTheme.spacing.lg,
    paddingVertical: adminTheme.spacing.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: adminTheme.spacing.lg,
    marginHorizontal: adminTheme.spacing.sm,
    borderRadius: adminTheme.radius.sm,
    position: 'relative',
  },
  navItemActive: {
    backgroundColor: adminTheme.colors.accentMuted,
  },
  activeIndicator: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: adminTheme.colors.accent,
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: adminTheme.colors.textMuted,
    marginLeft: adminTheme.spacing.md,
  },
  navLabelActive: {
    color: adminTheme.colors.text,
    fontWeight: '600',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: adminTheme.colors.border,
    paddingHorizontal: adminTheme.spacing.lg,
    paddingTop: adminTheme.spacing.md,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: adminTheme.spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: adminTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: adminTheme.colors.onAccent,
  },
  userInfo: {
    flex: 1,
    marginLeft: adminTheme.spacing.md,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: adminTheme.colors.text,
  },
  userRole: {
    fontSize: 11,
    color: adminTheme.colors.accent,
    marginTop: 2,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: adminTheme.radius.sm,
    backgroundColor: adminTheme.colors.dangerMuted,
    borderWidth: 1,
    borderColor: adminTheme.colors.danger,
  },
  signOutText: {
    color: adminTheme.colors.danger,
    fontWeight: '600',
    fontSize: 13,
    marginLeft: adminTheme.spacing.sm,
  },
});
