import { Tabs } from 'expo-router';
import { Home, Calendar, MessageSquare, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ClientLayout() {
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
        name="properties"
        options={{
          title: 'Explore Properties',
          tabBarLabel: 'Explore',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="my-bookings"
        options={{
          title: 'My Viewings & Bookings',
          tabBarLabel: 'Bookings',
          tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="feedback"
        options={{
          title: 'Send Feedback & Support',
          tabBarLabel: 'Support',
          tabBarIcon: ({ color, size }) => <MessageSquare color={color} size={size} />,
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
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
    </Tabs>
  );
}
