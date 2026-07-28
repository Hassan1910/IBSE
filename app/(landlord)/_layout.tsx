import { Tabs } from 'expo-router';
import { LayoutGrid, Home, Users, Wrench, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NotificationBell from '../../components/NotificationBell';

export default function LandlordLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#38BDF8',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarStyle: {
          backgroundColor: '#1E293B',
          borderTopColor: '#334155',
          paddingBottom: insets.bottom + 8,
          paddingTop: 8,
          height: 65 + insets.bottom,
        },
        headerStyle: {
          backgroundColor: '#1E293B',
          borderBottomWidth: 1,
          borderBottomColor: '#334155',
        },
        headerTintColor: '#F8FAFC',
        headerTitleStyle: {
          fontWeight: 'bold',
          fontSize: 18,
        },
        headerRight: () => <NotificationBell href="/(landlord)/notifications" />,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Landlord Overview',
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="properties"
        options={{
          title: 'My Properties',
          tabBarLabel: 'Properties',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="tenants"
        options={{
          title: 'My Tenants',
          tabBarLabel: 'Tenants',
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="maintenance"
        options={{
          title: 'Maintenance',
          tabBarLabel: 'Maintenance',
          tabBarIcon: ({ color, size }) => <Wrench color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'My Profile',
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />

      {/* Sub-screens reachable via router.push. `href: null` keeps them out of
          the tab bar while remaining navigable. */}
      <Tabs.Screen name="units" options={{ href: null, title: 'Manage Units' }} />
      <Tabs.Screen name="agreements" options={{ href: null, title: 'Rental Agreements' }} />
      <Tabs.Screen name="payments" options={{ href: null, title: 'Rent Payments' }} />
      <Tabs.Screen name="messages" options={{ href: null, title: 'Lease Messages' }} />
      <Tabs.Screen name="reports" options={{ href: null, title: 'Income Reports' }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
    </Tabs>
  );
}
