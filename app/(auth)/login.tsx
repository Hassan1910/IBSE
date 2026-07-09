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
import { useSignIn, useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { supabase, setSupabaseToken } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { resolveInvite, markInviteAccepted } from '../../lib/invites';

// Designated administrator account. Only this email is auto-provisioned with the
// admin role when no Supabase profile exists yet.
const ADMIN_EMAIL = 'admin@ibsahomes.com';

/**
 * Ensures a Supabase profile exists for the signed-in user (applying any admin
 * invite role), then records a 'login' audit entry. Safe to call on every login.
 */
async function provisionAndLogLogin(userId: string, email: string) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    let role = profile?.role as string | undefined;

    if (!profile) {
      const invite = await resolveInvite(email);
      const isAdmin = email.trim().toLowerCase() === ADMIN_EMAIL;
      role = invite?.role || (isAdmin ? 'admin' : 'client');
      await supabase.from('profiles').insert({
        id: userId,
        full_name: invite?.fullName || (isAdmin ? 'IBSA Admin' : 'New User'),
        email,
        phone: '+254700000000',
        role,
      });
      if (invite) await markInviteAccepted(invite.inviteId);
    }

    await logAudit({
      actorId: userId,
      actorEmail: email,
      actorRole: role ?? null,
      action: 'login',
      description: 'User signed in',
    });
  } catch (profileError) {
    console.error('[Login] Profile sync / audit error:', profileError);
  }
}

function decodeClerkToken(token: string): string | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    
    if (typeof atob === 'function') {
      return JSON.parse(atob(base64)).sub;
    }
    
    // Fallback base64 decoding for environments where atob might not be defined
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
      lookup[chars.charCodeAt(i)] = i;
    }
    
    let buffer = base64;
    while (buffer.length % 4) {
      buffer += '=';
    }
    
    const len = buffer.length;
    let placeholder = 0;
    if (buffer[len - 1] === '=') {
      placeholder = buffer[len - 2] === '=' ? 2 : 1;
    }
    
    const bytes = new Uint8Array((len * 3) / 4 - placeholder);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const encoded1 = lookup[buffer.charCodeAt(i)];
      const encoded2 = lookup[buffer.charCodeAt(i + 1)];
      const encoded3 = lookup[buffer.charCodeAt(i + 2)];
      const encoded4 = lookup[buffer.charCodeAt(i + 3)];
      
      bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
      if (p < bytes.length) {
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      }
      if (p < bytes.length) {
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
      }
    }
    
    let utf8String = '';
    for (let i = 0; i < bytes.length; i++) {
      utf8String += String.fromCharCode(bytes[i]);
    }
    return JSON.parse(utf8String).sub;
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

export default function LoginScreen() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { getToken, isSignedIn, signOut } = useAuth();
  const router = useRouter();

  // #region agent log
  console.log('[DEBUG d1d833] LoginScreen render', { clerkSignInLoaded: isLoaded });
  // #endregion

  const [emailAddress, setEmailAddress] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [pendingVerification, setPendingVerification] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  // OTP Verification Submission
  const onPressVerify = async () => {
    if (!isLoaded) return;

    if (!code) {
      Alert.alert('Validation Error', 'Please enter the verification code.');
      return;
    }

    try {
      setLoading(true);
      
      const factor = signIn.supportedSecondFactors?.find(
        (f: any) => f.strategy === 'email_code'
      ) || signIn.supportedSecondFactors?.find(
        (f: any) => f.strategy === 'phone_code'
      );
      
      const strategy = (factor ? factor.strategy : 'email_code') as 'email_code' | 'phone_code';
      
      const completeSignIn = await signIn.attemptSecondFactor({
        strategy,
        code,
      });

      if (completeSignIn.status === 'complete') {
        await setActive({ session: completeSignIn.createdSessionId });
        
        let sessionToken;
        try {
          sessionToken = await getToken({ template: 'supabase' });
        } catch (tokenError: any) {
          console.warn('[Login] Failed to fetch Supabase JWT template in OTP verification. Trying fallback:', tokenError.message);
          sessionToken = await getToken();
        }

        if (sessionToken) {
          setSupabaseToken(sessionToken);
          
          const userId = decodeClerkToken(sessionToken);
          if (userId) {
            await provisionAndLogLogin(userId, emailAddress);
          } else {
            console.error('[Login] Failed to extract user ID from Supabase token');
          }
        }
      } else {
        Alert.alert('Sign In Info', `Sign in is incomplete: ${completeSignIn.status}`);
      }
    } catch (err: any) {
      Alert.alert('Verification Failed', err.errors?.[0]?.message || err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // Sign In Process
  const onLoginPress = async () => {
    if (!isLoaded) return;

    if (!emailAddress || !password) {
      Alert.alert('Validation Error', 'Please enter your email and password.');
      return;
    }

    try {
      setLoading(true);

      // If user is already signed in, sign out first to avoid "session already exists"
      if (isSignedIn) {
        await signOut();
      }

      const signInAttempt = await signIn.create({
        identifier: emailAddress,
        password,
      });

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId });
        
        // Get JWT from Clerk for Supabase
        let sessionToken;
        try {
          sessionToken = await getToken({ template: 'supabase' });
        } catch (tokenError: any) {
          console.warn('[Login] Failed to fetch Supabase JWT template in login. Trying fallback:', tokenError.message);
          sessionToken = await getToken();
        }

        if (sessionToken) {
          setSupabaseToken(sessionToken);
          
          const userId = decodeClerkToken(sessionToken);
          if (userId) {
            await provisionAndLogLogin(userId, emailAddress);
          } else {
            console.error('[Login] Failed to extract user ID from Supabase token');
          }
        }
      } else if (
        signInAttempt.status === 'needs_second_factor' ||
        (signInAttempt.status as string) === 'needs_client_trust'
      ) {
        const factor = signInAttempt.supportedSecondFactors?.find(
          (f: any) => f.strategy === 'email_code'
        ) || signInAttempt.supportedSecondFactors?.find(
          (f: any) => f.strategy === 'phone_code'
        );
        
        if (factor) {
          await signIn.prepareSecondFactor({ strategy: factor.strategy as 'email_code' | 'phone_code' });
          setPendingVerification(true);
          const alertTitle = (signInAttempt.status as string) === 'needs_client_trust' ? 'Device Verification Required' : 'Verification Required';
          const alertMessage = (signInAttempt.status as string) === 'needs_client_trust'
            ? `A verification code has been sent to your registered ${factor.strategy === 'email_code' ? 'email' : 'phone'} to verify your device.`
            : `A verification code has been sent to your registered ${factor.strategy === 'email_code' ? 'email' : 'phone'}.`;
          Alert.alert(alertTitle, alertMessage);
        } else {
          Alert.alert('Sign In Info', `Sign in status: ${signInAttempt.status}`);
        }
      } else {
        console.warn('[Login] Sign in status incomplete:', signInAttempt.status);
        Alert.alert('Sign In Info', `Sign in is incomplete: ${signInAttempt.status}`);
      }
    } catch (err: any) {
      Alert.alert('Login Failed', err.errors?.[0]?.message || err.message || 'Invalid email or password.');
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
            <Text style={styles.cardTitle}>Welcome Back</Text>

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

            <TouchableOpacity style={styles.submitButton} onPress={onLoginPress} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Log In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footerLink}>
              <Text style={styles.footerText}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => router.replace('/(auth)/signup')}>
                <Text style={styles.link}>Sign Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Verify Account</Text>
            <Text style={styles.infoText}>
              Please enter the verification code sent to <Text style={styles.boldText}>{emailAddress}</Text>.
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
    backgroundColor: '#0F172A',
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
    color: '#38BDF8',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#1E293B',
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
