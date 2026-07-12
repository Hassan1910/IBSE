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
import { supabase, setSupabaseToken } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { resolveInvite, markInviteAccepted, hasPendingInvite } from '../../lib/invites';
import { isPublicSignupAllowed } from '../../lib/settings';

// Staff roles (landlord, finance, admin) are invite-only when public
// signup is disabled: the administrator pre-registers those emails.
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
  const [pendingVerification, setPendingVerification] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);

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

      await signUp.create({
        emailAddress,
        password,
        firstName: fullName.split(' ')[0] || '',
        lastName: fullName.split(' ').slice(1).join(' ') || '',
      });

      // Only prompt OTP when Clerk explicitly requires it.
      if (signUp.status === 'complete') {
        await completeSignUpFlow(signUp.createdUserId, signUp.createdSessionId);
        return;
      }

      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err: any) {
      Alert.alert('Signup Failed', err.errors?.[0]?.message || err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // OTP Verification Submission
  const onPressVerify = async () => {
    if (!isLoaded) return;

    if (!code) {
      Alert.alert('Validation Error', 'Please enter the verification code.');
      return;
    }

    try {
      setLoading(true);
      const completeSignUp = await signUp.attemptEmailAddressVerification({
        code,
      });

      if (completeSignUp.status !== 'complete') {
        throw new Error('Verification not complete. Please check the code.');
      }

      await completeSignUpFlow(completeSignUp.createdUserId, completeSignUp.createdSessionId);
    } catch (err: any) {
      Alert.alert('Verification Failed', err.errors?.[0]?.message || err.message || 'An error occurred.');
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

        {!pendingVerification ? (
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
                Staff and landlord accounts are created by invitation from the administrator.
              </Text>
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
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Verify Email</Text>
            <Text style={styles.infoText}>
              A 6-digit verification code was sent to <Text style={styles.boldText}>{emailAddress}</Text>.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Verification Code</Text>
              <TextInput
                style={[styles.input, styles.otpInput]}
                placeholder="123456"
                placeholderTextColor="#999"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={onPressVerify} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Verify & Complete</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setPendingVerification(false)}
              disabled={loading}
            >
              <Text style={styles.backButtonText}>Back to details</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
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
  footerText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  link: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: 'bold',
  },
  infoText: {
    fontSize: 15,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  boldText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
  },
  otpInput: {
    textAlign: 'center',
    fontSize: 24,
    letterSpacing: 6,
    fontWeight: 'bold',
  },
  backButton: {
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
