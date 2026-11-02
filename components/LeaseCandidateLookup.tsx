import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { supabase } from '../lib/supabase';

export interface LeaseCandidate {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

/**
 * Landlords can only list tenants/clients they are already linked to (RLS).
 * To start a lease with someone new, they look the person up by exact email.
 * Backed by the find_lease_candidate_by_email RPC (landlord/admin/finance only).
 */
export default function LeaseCandidateLookup({ onFound }: { onFound: (c: LeaseCandidate) => void }) {
  const [email, setEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const lookup = async () => {
    const value = email.trim();
    if (!value) return;
    setSearching(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc('find_lease_candidate_by_email', { p_email: value });
      if (error) throw error;
      const found = (data as LeaseCandidate[] | null)?.[0];
      if (!found) {
        setMessage('No tenant or client account with that email.');
        return;
      }
      onFound(found);
      setEmail('');
      setMessage(`Selected ${found.full_name}.`);
    } catch (err: any) {
      console.error('Lease candidate lookup error:', err);
      setMessage(err?.message || 'Lookup failed.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Find by exact email"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={lookup}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.btn} onPress={lookup} disabled={searching}>
          {searching ? <ActivityIndicator color="#0F172A" size="small" /> : <Search size={18} color="#0F172A" />}
        </TouchableOpacity>
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#F8FAFC',
  },
  btn: { backgroundColor: '#38BDF8', borderRadius: 8, padding: 12 },
  message: { color: '#94A3B8', fontSize: 13, marginTop: 6 },
});
