import * as React from 'react';
import {
  TextInput,
  View,
  Text,
  Alert,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSignUp, useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { deriveClerkUsername, withUsernameSuffix } from '../../lib/clerk';
import { supabase, setSupabaseToken } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { resolveInvite, markInviteAccepted, hasPendingInvite } from '../../lib/invites';
import { isPublicSignupAllowed } from '../../lib/settings';
import RequestLandlordAccountModal from '../../components/RequestLandlordAccountModal';

// Client and tenant self-register. Landlord accounts are admin-created
// after a request; finance/admin are invite-only.
const ROLES = [
  { label: 'Client (Property Browser)', value: 'client' },
  { label: 'Tenant (Renter)', value: 'tenant' },
];

export default function SignUpScreen() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const { getToken } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = React.useState('');
  const [emailAddress, setEmailAddress] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [role, setRole] = React.useState<'tenant' | 'client'>('client');
  const [loading, setLoading] = React.useState(false);
  const [landlordRequestVisible, setLandlordRequestVisible] = React.useState(false);

  const completeSignUpFlow = async (createdUserId: string | null | undefined, createdSessionId: string | null | undefined) => {
    if (!createdSessionId || !setActive) {
      throw new Error('Sign up completed but no session was created.');
    }

    // Set session active in Clerk
    await setActive({ session: createdSessionId });

    // Get authenticated Supabase JWT
    let sessionToken;
    try {
      sessionToken = await getToken({ template: 'supabase' });
    } catch (tokenError: any) {
      console.warn('[SignUp] Failed to fetch Supabase JWT template. Trying fallback:', tokenError.message);
      sessionToken = await getToken();
    }

    if (!sessionToken) return;

    setSupabaseToken(sessionToken);

    // If an admin pre-registered this email, honour the invited role.
    const invite = await resolveInvite(emailAddress);
    const finalRole = invite?.role || role;

    // Insert new profile record in Supabase
    const { error: dbError } = await supabase.from('profiles').insert({
      id: createdUserId,
      full_name: fullName,
      email: emailAddress,
      phone,
      role: finalRole,
    });

    if (dbError) {
      console.error('[SignUp] Supabase profile insertion failed:', dbError);
      Alert.alert(
        'Sync Warning',
        'Your account is created, but we failed to build your profile database entry. Please contact your administrator.'
      );
      return;
    }

    if (invite) await markInviteAccepted(invite.inviteId);
    if (createdUserId) {
      await logAudit({
        actorId: createdUserId,
        actorEmail: emailAddress,
        actorRole: finalRole,
        action: 'login',
        description: 'Account created and signed in',
      });
    }
  };

  // Initial Signup Submission
  const onSignUpPress = async () => {
    if (!isLoaded) return;

    if (!fullName || !emailAddress || !password || !phone) {
      Alert.alert('Validation Error', 'Please fill in all details.');
      return;
    }

    try {
      setLoading(true);

      const allowPublic = await isPublicSignupAllowed();
      if (!allowPublic) {
        const invited = await hasPendingInvite(emailAddress);
        if (!invited) {
          Alert.alert(
            'Invite Required',
            'Public sign-up is disabled. Ask an administrator to invite your email before creating an account.',
          );
          return;
        }
      }

      const firstName = fullName.split(' ')[0] || '';
      const lastName = fullName.split(' ').slice(1).join(' ') || '';
      let username = deriveClerkUsername(fullName, emailAddress);

      let created;
      try {
        created = await signUp.create({
          emailAddress,
          password,
          username,
          firstName,
          lastName,
        });
      } catch (createErr: any) {
        const usernameTaken = createErr?.errors?.some(
          (e: any) =>
            e.code === 'form_identifier_exists' &&
            (e.meta?.paramName === 'username' || e.meta?.param_name === 'username'),
        );
        if (!usernameTaken) throw createErr;
        username = withUsernameSuffix(username);
        created = await signUp.create({
          emailAddress,
          password,
          username,
          firstName,
          lastName,
        });
      }

      // If create succeeded but username was still required, set it and continue.
      if (created.status !== 'complete' && created.missingFields?.includes('username')) {
        username = withUsernameSuffix(username);
        created = await signUp.update({ username });
      }

      // Verify-at-sign-up is off in Clerk — create should finish in one step.
      if (created.status !== 'complete') {
        const missing = [
          ...(created.missingFields || []),
          ...(created.unverifiedFields || []),
        ].join(', ');
        throw new Error(
          missing
            ? `Sign-up incomplete. Missing or unverified: ${missing}.`
            : `Sign-up incomplete (status: ${created.status}).`,
        );
      }

      await completeSignUpFlow(created.createdUserId, created.createdSessionId);
    } catch (err: any) {
      Alert.alert('Signup Failed', err.errors?.[0]?.message || err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>IBSA HOMES</Text>
          <Text style={styles.subtitle}>Real Estate & Property Management</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create Account</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Philip Liban"
              placeholderTextColor="#999"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="name@domain.com"
              placeholderTextColor="#999"
              value={emailAddress}
              onChangeText={setEmailAddress}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. +254 742034932"
              placeholderTextColor="#999"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Select Role</Text>
            <View style={styles.roleContainer}>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r.value}
                  style={[
                    styles.roleBtn,
                    role === r.value && styles.roleBtnActive,
                  ]}
                  onPress={() => setRole(r.value as any)}
                >
                  <Text
                    style={[
                      styles.roleText,
                      role === r.value && styles.roleTextActive,
                    ]}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.roleHint}>
              Landlord accounts are created by IBSA after review — request access below.
              Staff accounts (finance/admin) are invited by an administrator.
            </Text>
            <TouchableOpacity
              style={styles.landlordRequestLink}
              onPress={() => setLandlordRequestVisible(true)}
              accessibilityRole="button"
            >
              <Text style={styles.link}>Request a landlord account</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.submitButton} onPress={onSignUpPress} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Sign Up</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footerLink}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
              <Text style={styles.link}>Log In</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.backToListings}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.link}>Back to listings</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <RequestLandlordAccountModal
        visible={landlordRequestVisible}
        onClose={() => setLandlordRequestVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A', // Deep modern dark slate
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: Platform.OS === 'ios' ? 40 : 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#38BDF8', // Cyan/Sky accent
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8', // Slate gray
    marginTop: 4,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#1E293B', // Dark slate card
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 16,
  },
  roleContainer: {
    marginTop: 6,
  },
  roleBtn: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  roleBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  roleText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  roleTextActive: {
    color: '#38BDF8',
    fontWeight: 'bold',
  },
  roleHint: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  landlordRequestLink: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  submitButton: {
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 4,
  },
  submitButtonText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footerLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  backToListings: {
    alignItems: 'center',
    marginTop: 16,
  },
  footerText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  link: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
