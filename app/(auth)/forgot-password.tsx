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
import { useSignIn } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { KeyRound, Mail, ArrowLeft } from 'lucide-react-native';

type Step = 'request' | 'reset';

export default function ForgotPasswordScreen() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [step, setStep] = React.useState<Step>('request');
  const [emailAddress, setEmailAddress] = React.useState('');
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const onRequestReset = async () => {
    if (!isLoaded || !signIn) return;
    if (!emailAddress.trim()) {
      Alert.alert('Validation Error', 'Enter the email for your account.');
      return;
    }

    try {
      setLoading(true);
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: emailAddress.trim(),
      });
      setStep('reset');
      Alert.alert('Check your email', 'We sent a password reset code to your inbox.');
    } catch (err: any) {
      Alert.alert(
        'Reset Failed',
        err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || 'Could not start password reset.',
      );
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    if (!isLoaded || !signIn) return;
    if (!code.trim()) {
      Alert.alert('Validation Error', 'Enter the reset code from your email.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Validation Error', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Validation Error', 'Passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: code.trim(),
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        Alert.alert('Password Updated', 'Your password was reset. You are now signed in.');
        // Root layout redirects by role
      } else if (result.status === 'needs_second_factor') {
        Alert.alert('Additional verification required', 'Please complete two-factor authentication from the login screen.');
        router.replace('/(auth)/login');
      } else {
        Alert.alert('Almost done', `Status: ${result.status}. Try signing in with your new password.`);
        router.replace('/(auth)/login');
      }
    } catch (err: any) {
      Alert.alert(
        'Reset Failed',
        err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || 'Could not reset password.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backRow} onPress={() => router.replace('/(auth)/login')}>
          <ArrowLeft size={18} color="#38BDF8" />
          <Text style={styles.backText}>Back to login</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>
          {step === 'request'
            ? 'Enter your account email and we will send a reset code.'
            : 'Enter the code from your email and choose a new password.'}
        </Text>

        {step === 'request' ? (
          <>
            <View style={styles.inputWrap}>
              <Mail size={18} color="#94A3B8" style={styles.icon} />
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email address"
                placeholderTextColor="#64748B"
                value={emailAddress}
                onChangeText={setEmailAddress}
              />
            </View>
            <TouchableOpacity style={styles.btn} onPress={onRequestReset} disabled={loading}>
              {loading ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.btnText}>Send Reset Code</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.inputWrap}>
              <KeyRound size={18} color="#94A3B8" style={styles.icon} />
              <TextInput
                style={styles.input}
                placeholder="Reset code"
                placeholderTextColor="#64748B"
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
              />
            </View>
            <View style={styles.inputWrap}>
              <KeyRound size={18} color="#94A3B8" style={styles.icon} />
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor="#64748B"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>
            <View style={styles.inputWrap}>
              <KeyRound size={18} color="#94A3B8" style={styles.icon} />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor="#64748B"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            </View>
            <TouchableOpacity style={styles.btn} onPress={onResetPassword} disabled={loading}>
              {loading ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.btnText}>Update Password</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep('request')}>
              <Text style={styles.link}>Use a different email</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 8 },
  backText: { color: '#38BDF8', fontWeight: '600' },
  title: { color: '#F8FAFC', fontSize: 26, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#94A3B8', fontSize: 14, lineHeight: 20, marginBottom: 24 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  icon: { marginRight: 8 },
  input: { flex: 1, color: '#F8FAFC', paddingVertical: 14, fontSize: 15 },
  btn: {
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { color: '#0F172A', fontWeight: '700', fontSize: 15 },
  link: { color: '#38BDF8', textAlign: 'center', marginTop: 16, fontWeight: '600' },
});
