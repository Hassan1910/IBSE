import React, { useEffect } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Drawer } from 'expo-router/drawer';
import { DrawerToggleButton } from '@react-navigation/drawer';
import { usePathname, useRouter } from 'expo-router';
import AdminDrawerContent from '../../components/admin/AdminDrawerContent';
import { adminTheme } from '../../constants/adminTheme';
import { ADMIN_NAV_ITEMS, getNavItemByName } from '../../lib/adminNav';
import { useRole } from '../../hooks/useRole';

export default function AdminLayout() {
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && width >= 1024;
  const { role, loading: roleLoading } = useRole();
  const pathname = usePathname();
  const router = useRouter();

  // Finance staff may only use finance-allowed routes (and notifications).
  useEffect(() => {
    if (roleLoading || role !== 'finance') return;
    const segment = pathname.split('/').filter(Boolean).pop() || '';
    if (segment === 'notifications') return;
    const item = getNavItemByName(segment);
    if (item?.adminOnly) {
      router.replace('/(admin)/dashboard');
    }
  }, [role, roleLoading, pathname, router]);

  const hiddenDrawerItem = { display: 'none' as const, height: 0, width: 0 };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        drawerContent={(props) => <AdminDrawerContent {...props} />}
        screenOptions={{
          drawerType: isWideWeb ? 'permanent' : 'front',
          drawerStyle: {
            width: adminTheme.sidebar.width,
            backgroundColor: adminTheme.colors.surface,
            borderRightColor: adminTheme.colors.border,
            borderRightWidth: 1,
          },
          overlayColor: 'rgba(15, 23, 42, 0.65)',
          swipeEnabled: !isWideWeb,
          headerShown: true,
          headerStyle: {
            backgroundColor: adminTheme.colors.surface,
            borderBottomWidth: 1,
            borderBottomColor: adminTheme.colors.border,
          },
          headerTintColor: adminTheme.colors.text,
          headerTitleStyle: {
            fontWeight: '700',
            fontSize: 18,
          },
          headerLeft: isWideWeb
            ? () => null
            : () => <DrawerToggleButton tintColor={adminTheme.colors.text} />,
          drawerItemStyle: hiddenDrawerItem,
        }}
      >
        {ADMIN_NAV_ITEMS.map((item) => {
          const navItem = getNavItemByName(item.name)!;
          return (
            <Drawer.Screen
              key={item.name}
              name={item.name}
              options={{
                title: navItem.title,
                drawerItemStyle: hiddenDrawerItem,
              }}
            />
          );
        })}
        <Drawer.Screen
          name="notifications"
          options={{
            title: 'Notifications',
            drawerItemStyle: hiddenDrawerItem,
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}
