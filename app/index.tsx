import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import LandingMarketing from '../components/LandingMarketing';
import RequestLandlordAccountModal from '../components/RequestLandlordAccountModal';
import PropertyBrowseList, {
  type BrowseProperty,
} from '../components/PropertyBrowseList';

export default function PublicListingsLanding() {
  const router = useRouter();
  const listRef = useRef<FlatList<BrowseProperty>>(null);
  const listingsOffset = useRef(0);
  const [landlordRequestVisible, setLandlordRequestVisible] = useState(false);

  const goLogin = useCallback(() => {
    router.push('/(auth)/login');
  }, [router]);

  const goSignup = useCallback(() => {
    router.push('/(auth)/signup');
  }, [router]);

  const openLandlordRequest = useCallback(() => {
    setLandlordRequestVisible(true);
  }, []);

  const scrollToListings = useCallback(() => {
    listRef.current?.scrollToOffset({
      offset: Math.max(listingsOffset.current - 8, 0),
      animated: true,
    });
  }, []);

  const onListingsLayout = useCallback((y: number) => {
    listingsOffset.current = y;
  }, []);

  const header = useMemo(
    () => (
      <LandingMarketing
        onLogin={goLogin}
        onSignup={goSignup}
        onBrowse={scrollToListings}
        onRequestLandlord={openLandlordRequest}
        onListingsLayout={onListingsLayout}
      />
    ),
    [goLogin, goSignup, scrollToListings, openLandlordRequest, onListingsLayout]
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <PropertyBrowseList
        ref={listRef}
        onAction={goLogin}
        ListHeaderComponent={header}
      />
      <RequestLandlordAccountModal
        visible={landlordRequestVisible}
        onClose={() => setLandlordRequestVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
