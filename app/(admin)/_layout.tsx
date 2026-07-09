import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Drawer } from 'expo-router/drawer';
import { DrawerToggleButton } from '@react-navigation/drawer';
import AdminDrawerContent from '../../components/admin/AdminDrawerContent';
import { adminTheme } from '../../constants/adminTheme';
import { ADMIN_NAV_ITEMS, getNavItemByName } from '../../lib/adminNav';

export default function AdminLayout() {
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && width >= 1024;

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
      </Drawer>
    </GestureHandlerRootView>
  );
}
