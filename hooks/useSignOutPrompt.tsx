import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { completeSignOut, signOutErrorMessage } from '../lib/signOut';

/**
 * Confirm-then-sign-out that works on native and web.
 * react-native-web 0.21 implements Alert.alert as an empty function, so a
 * confirm built on Alert never runs its buttons and sign-out appears dead.
 */
export function useSignOutPrompt() {
  const { signOut } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestSignOut = () => {
    if (busy) return;
    setError(null);
    setVisible(true);
  };

  const cancel = () => {
    if (busy) return;
    setVisible(false);
    setError(null);
  };

  const confirmSignOut = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void completeSignOut(() => signOut())
      .then(() => {
        setVisible(false);
      })
      .catch((err: unknown) => {
        setError(signOutErrorMessage(err));
        setBusy(false);
      });
  };

  const signOutModal = (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Sign Out</Text>
          <Text style={styles.message}>Are you sure you want to sign out?</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={cancel}
              disabled={busy}
              accessibilityRole="button"
              testID="cancel-sign-out"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={confirmSignOut}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Confirm sign out"
              testID="confirm-sign-out"
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmText}>Sign Out</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return { requestSignOut, signOutModal, signingOut: busy };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 24,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  message: {
    color: '#94A3B8',
    fontSize: 15,
    lineHeight: 22,
  },
  error: {
    color: '#F87171',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 20,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 8,
  },
  cancelText: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 120,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
