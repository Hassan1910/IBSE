import { Tabs } from 'expo-router';
import { Home, CreditCard, Wrench, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TenantLayout() {
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
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'My Lease & Rent',
          tabBarLabel: 'Lease',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="rent"
        options={{
          title: 'Pay Rent / Submit Reference',
          tabBarLabel: 'Pay Rent',
          tabBarIcon: ({ color, size }) => <CreditCard color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="maintenance"
        options={{
          title: 'Maintenance Requests',
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
      <Tabs.Screen name="agreements" options={{ href: null, title: 'My Agreement' }} />
      <Tabs.Screen name="documents" options={{ href: null, title: 'My Documents' }} />
      <Tabs.Screen name="feedback" options={{ href: null, title: 'Feedback & Complaints' }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
      <Tabs.Screen name="help" options={{ href: null, title: 'Help & Guides' }} />
    </Tabs>
  );
}
