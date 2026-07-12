import { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { ArrowDown, KeyRound, Building2, Handshake } from 'lucide-react-native';

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1489392191049-fc10c97e64b6?auto=format&fit=crop&w=2400&q=80';

type LandingMarketingProps = {
  onLogin: () => void;
  onSignup: () => void;
  onBrowse: () => void;
  onRequestLandlord: () => void;
  onListingsLayout: (y: number) => void;
};

export default function LandingMarketing({
  onLogin,
  onSignup,
  onBrowse,
  onRequestLandlord,
  onListingsLayout,
}: LandingMarketingProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isWide = width >= 900;
  const isCompact = width < 400;
  const heroHeight = Math.max(height, 640);
  const brandSize = isWide ? 72 : isCompact ? 42 : 52;

  const brandOpacity = useSharedValue(0);
  const brandY = useSharedValue(28);
  const copyOpacity = useSharedValue(0);
  const copyY = useSharedValue(20);
  const ctaOpacity = useSharedValue(0);
  const glow = useSharedValue(0.35);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    brandOpacity.value = withTiming(1, { duration: 900, easing: ease });
    brandY.value = withTiming(0, { duration: 900, easing: ease });
    copyOpacity.value = withDelay(280, withTiming(1, { duration: 800, easing: ease }));
    copyY.value = withDelay(280, withTiming(0, { duration: 800, easing: ease }));
    ctaOpacity.value = withDelay(520, withTiming(1, { duration: 700, easing: ease }));
    glow.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.3, { duration: 3200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [brandOpacity, brandY, copyOpacity, copyY, ctaOpacity, glow]);

  const brandAnim = useAnimatedStyle(() => ({
    opacity: brandOpacity.value,
    transform: [{ translateY: brandY.value }],
  }));

  const copyAnim = useAnimatedStyle(() => ({
    opacity: copyOpacity.value,
    transform: [{ translateY: copyY.value }],
  }));

  const ctaAnim = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
  }));

  const glowAnim = useAnimatedStyle(() => ({
    opacity: glow.value,
  }));

  return (
    <View>
      {/* Hero */}
      <View style={[styles.hero, { height: heroHeight }]}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image
            source={{ uri: HERO_IMAGE }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <LinearGradient
            colors={[
              'rgba(15, 23, 42, 0.55)',
              'rgba(15, 23, 42, 0.35)',
              'rgba(15, 23, 42, 0.92)',
              '#0F172A',
            ]}
            locations={[0, 0.35, 0.75, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.horizonGlow,
            glowAnim,
            isWide ? styles.horizonGlowWide : null,
          ]}
        />

        <View
          style={[
            styles.nav,
            {
              paddingTop: insets.top + 12,
              paddingHorizontal: isWide ? 48 : 20,
            },
          ]}
        >
          <Text style={styles.navBrand}>IBSA Homes</Text>
          <View style={styles.navActions}>
            <TouchableOpacity
              style={styles.navLogin}
              onPress={onLogin}
              accessibilityRole="button"
              accessibilityLabel="Log in"
            >
              <Text style={styles.navLoginText}>Log in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navSignup}
              onPress={onSignup}
              accessibilityRole="button"
              accessibilityLabel="Sign up"
            >
              <Text style={styles.navSignupText}>Sign up</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View
          style={[
            styles.heroContent,
            {
              paddingHorizontal: isWide ? 48 : 20,
              paddingBottom: 48 + insets.bottom,
              maxWidth: isWide ? 720 : undefined,
            },
          ]}
        >
          <Animated.Text
            style={[
              styles.heroBrand,
              brandAnim,
              { fontSize: brandSize, lineHeight: brandSize + 4 },
            ]}
          >
            IBSA Homes
          </Animated.Text>
          <Animated.View style={copyAnim}>
            <Text style={styles.heroHeadline}>
              Homes, land & rentals across Marsabit — managed in one place.
            </Text>
            <Text style={styles.heroSupport}>
              Browse available listings, book viewings, and manage leases with the
              team that knows the ground.
            </Text>
          </Animated.View>
          <Animated.View style={[styles.ctaRow, ctaAnim]}>
            <TouchableOpacity
              style={styles.ctaPrimary}
              onPress={onBrowse}
              accessibilityRole="button"
            >
              <Text style={styles.ctaPrimaryText}>Browse listings</Text>
              <ArrowDown size={18} color="#0F172A" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ctaSecondary}
              onPress={onSignup}
              accessibilityRole="button"
            >
              <Text style={styles.ctaSecondaryText}>Create account</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>

      {/* How it works */}
      <View style={styles.section}>
        <View style={[styles.sectionInner, isWide && styles.sectionInnerWide]}>
          <Text style={styles.sectionTitle}>How it works</Text>
          <Text style={styles.sectionLead}>
            From first look to signed lease — clear steps, local support.
          </Text>
          <View style={[styles.steps, isWide && styles.stepsWide]}>
            {[
              {
                n: '01',
                title: 'Browse what is available',
                body: 'Filter rentals, sales, and land listed for Marsabit and surrounding areas.',
              },
              {
                n: '02',
                title: 'Book a viewing',
                body: 'Request a time that works for you. Our team confirms and walks you through.',
              },
              {
                n: '03',
                title: 'Move in with confidence',
                body: 'Tenants pay rent, raise maintenance, and keep documents in one portal.',
              },
            ].map((step, i) => (
              <View
                key={step.n}
                style={[
                  styles.step,
                  isWide && styles.stepWide,
                  i < 2 && !isWide ? styles.stepDivider : null,
                  isWide && i < 2 ? styles.stepDividerWide : null,
                ]}
              >
                <Text style={styles.stepNum}>{step.n}</Text>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepBody}>{step.body}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Audiences */}
      <View style={[styles.section, styles.sectionAlt]}>
        <View style={[styles.sectionInner, isWide && styles.sectionInnerWide]}>
          <Text style={styles.sectionTitle}>Built for every side of the deal</Text>
          <Text style={styles.sectionLead}>
            One system for clients, tenants, landlords, and the IBSA operations team.
          </Text>
          <View style={[styles.audienceGrid, isWide && styles.audienceGridWide]}>
            {[
              {
                icon: KeyRound,
                title: 'Looking to rent or buy',
                body: 'Explore listings, request viewings, and follow up without the phone tag.',
                action: null as null | { label: string; onPress: () => void },
              },
              {
                icon: Building2,
                title: 'Already a tenant',
                body: 'Track rent, maintenance, leases, and documents from your phone.',
                action: null,
              },
              {
                icon: Handshake,
                title: 'Property owners',
                body: 'Landlord accounts are created by IBSA after review. Request access and we will follow up.',
                action: { label: 'Request landlord account', onPress: onRequestLandlord },
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <View
                  key={item.title}
                  style={[styles.audienceItem, isWide && styles.audienceItemWide]}
                >
                  <Icon size={22} color="#38BDF8" strokeWidth={1.75} />
                  <Text style={styles.audienceTitle}>{item.title}</Text>
                  <Text style={styles.audienceBody}>{item.body}</Text>
                  {item.action ? (
                    <TouchableOpacity
                      style={styles.audienceCta}
                      onPress={item.action.onPress}
                      accessibilityRole="button"
                      accessibilityLabel={item.action.label}
                    >
                      <Text style={styles.audienceCtaText}>{item.action.label}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* Listings intro */}
      <View
        style={styles.listingsIntro}
        onLayout={(e) => onListingsLayout(e.nativeEvent.layout.y)}
      >
        <View style={[styles.sectionInner, isWide && styles.sectionInnerWide]}>
          <Text style={styles.sectionTitle}>Available now</Text>
          <Text style={styles.sectionLead}>
            Live listings for rent, sale, and land. Sign in to book a viewing.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    justifyContent: 'space-between',
    overflow: 'hidden',
    backgroundColor: '#0F172A',
  },
  horizonGlow: {
    position: 'absolute',
    bottom: '22%',
    alignSelf: 'center',
    width: '70%',
    height: 120,
    borderRadius: 999,
    backgroundColor: 'rgba(56, 189, 248, 0.22)',
  },
  horizonGlowWide: {
    height: 160,
    width: '55%',
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  navBrand: {
    fontFamily: 'Syne_700Bold',
    color: '#F8FAFC',
    fontSize: 16,
    letterSpacing: 0.4,
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navLogin: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(248, 250, 252, 0.25)',
  },
  navLoginText: {
    fontFamily: 'DMSans_500Medium',
    color: '#F8FAFC',
    fontSize: 14,
  },
  navSignup: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#38BDF8',
  },
  navSignupText: {
    fontFamily: 'DMSans_700Bold',
    color: '#0F172A',
    fontSize: 14,
  },
  heroContent: {
    zIndex: 2,
    width: '100%',
  },
  heroBrand: {
    fontFamily: 'Syne_800ExtraBold',
    color: '#F8FAFC',
    fontSize: 52,
    lineHeight: 56,
    letterSpacing: -1.2,
    marginBottom: 16,
  },
  heroHeadline: {
    fontFamily: 'DMSans_500Medium',
    color: '#E2E8F0',
    fontSize: 20,
    lineHeight: 28,
    marginBottom: 12,
    maxWidth: 520,
  },
  heroSupport: {
    fontFamily: 'DMSans_400Regular',
    color: '#94A3B8',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
    maxWidth: 480,
  },
  ctaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
  },
  ctaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  ctaPrimaryText: {
    fontFamily: 'DMSans_700Bold',
    color: '#0F172A',
    fontSize: 15,
  },
  ctaSecondary: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248, 250, 252, 0.28)',
  },
  ctaSecondaryText: {
    fontFamily: 'DMSans_500Medium',
    color: '#F8FAFC',
    fontSize: 15,
  },
  section: {
    paddingVertical: 56,
    backgroundColor: '#0F172A',
  },
  sectionInner: {
    paddingHorizontal: 20,
    width: '100%',
  },
  sectionInnerWide: {
    paddingHorizontal: 48,
    alignSelf: 'center',
    maxWidth: 1100,
  },
  sectionAlt: {
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1E293B',
  },
  sectionTitle: {
    fontFamily: 'Syne_700Bold',
    color: '#F8FAFC',
    fontSize: 28,
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  sectionLead: {
    fontFamily: 'DMSans_400Regular',
    color: '#94A3B8',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 36,
    maxWidth: 540,
  },
  steps: {
    gap: 0,
  },
  stepsWide: {
    flexDirection: 'row',
    gap: 0,
  },
  step: {
    paddingVertical: 20,
  },
  stepWide: {
    flex: 1,
    paddingVertical: 8,
    paddingRight: 28,
  },
  stepDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  stepDividerWide: {
    borderBottomWidth: 0,
    borderRightWidth: 1,
    borderRightColor: '#1E293B',
    marginRight: 28,
  },
  stepNum: {
    fontFamily: 'Syne_700Bold',
    color: '#38BDF8',
    fontSize: 13,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  stepTitle: {
    fontFamily: 'DMSans_700Bold',
    color: '#F8FAFC',
    fontSize: 17,
    marginBottom: 8,
  },
  stepBody: {
    fontFamily: 'DMSans_400Regular',
    color: '#94A3B8',
    fontSize: 15,
    lineHeight: 22,
  },
  audienceGrid: {
    gap: 36,
  },
  audienceGridWide: {
    flexDirection: 'row',
    gap: 40,
  },
  audienceItem: {
    gap: 10,
  },
  audienceItemWide: {
    flex: 1,
  },
  audienceTitle: {
    fontFamily: 'DMSans_700Bold',
    color: '#F8FAFC',
    fontSize: 17,
    marginTop: 4,
  },
  audienceBody: {
    fontFamily: 'DMSans_400Regular',
    color: '#94A3B8',
    fontSize: 15,
    lineHeight: 22,
  },
  audienceCta: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
  },
  audienceCtaText: {
    fontFamily: 'DMSans_700Bold',
    color: '#38BDF8',
    fontSize: 13,
  },
  listingsIntro: {
    paddingTop: 56,
    paddingBottom: 8,
    backgroundColor: '#0F172A',
  },
});
