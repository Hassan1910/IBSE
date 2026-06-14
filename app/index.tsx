import { View, ActivityIndicator, StyleSheet } from 'react-native';

export default function EntryPoint() {
  // Renders a loading screen at the root path (/).
  // The root layout's InitialLayout hook handles authentication-based 
  // redirects imperatively once the navigation state and user roles are ready.
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#38BDF8" />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
