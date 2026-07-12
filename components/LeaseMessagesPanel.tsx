import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { notifyUser, notifyPropertyOwner } from '../lib/notifications';
import { Send } from 'lucide-react-native';

type MessageRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  profiles?: { full_name: string | null } | null;
};

type Props = {
  /** When omitted, uses route param `leaseId` or auto-picks caller's active lease. */
  leaseId?: string;
  role: 'tenant' | 'landlord';
};

const TYPING_IDLE_MS = 2000;
const TYPING_THROTTLE_MS = 400;

export default function LeaseMessagesPanel({ leaseId: leaseIdProp, role }: Props) {
  const { user } = useUser();
  const params = useLocalSearchParams<{ leaseId?: string; id?: string }>();
  const [leaseId, setLeaseId] = useState<string | null>(leaseIdProp || params.leaseId || params.id || null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyTitle, setPropertyTitle] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const listRef = useRef<FlatList<MessageRow>>(null);
  const peerIdRef = useRef<string | null>(null);
  const peerNameRef = useRef<string>('User');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);

  const appendMessage = useCallback((row: MessageRow) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === row.id)) return prev;
      return [...prev, row];
    });
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const resolveLease = useCallback(async () => {
    if (!user?.id) return null;

    const loadLeaseById = async (id: string) => {
      const { data } = await supabase
        .from('leases')
        .select('id, tenant_id, property_id, properties ( title, owner_id )')
        .eq('id', id)
        .maybeSingle();
      return data as any;
    };

    if (leaseIdProp || params.leaseId || params.id) {
      const id = (leaseIdProp || params.leaseId || params.id) as string;
      const byLease = await loadLeaseById(id);
      if (byLease) return byLease;

      // Older notifications may store message_thread id instead of lease id.
      const { data: thread } = await supabase
        .from('message_threads')
        .select('lease_id')
        .eq('id', id)
        .maybeSingle();
      if (thread?.lease_id) {
        return loadLeaseById(thread.lease_id);
      }
      return null;
    }

    // Tenant: auto-pick their own pending/active lease.
    // Landlord must open Messages with an explicit leaseId (inbox / agreements / tenants).
    if (role === 'tenant') {
      const { data } = await supabase
        .from('leases')
        .select('id, tenant_id, property_id, properties ( title, owner_id )')
        .eq('tenant_id', user.id)
        .in('status', ['pending', 'active'])
        .order('status', { ascending: true })
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    }

    return null;
  }, [user?.id, leaseIdProp, params.leaseId, params.id, role]);

  const loadMessages = useCallback(async (tid: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('id, sender_id, body, created_at, profiles:sender_id ( full_name )')
      .eq('thread_id', tid)
      .order('created_at', { ascending: true });
    if (error) throw error;
    setMessages((data as any) || []);
  }, []);

  useEffect(() => {
    const boot = async () => {
      if (!user?.id) return;
      try {
        setLoading(true);
        const lease = await resolveLease();
        if (!lease?.id) {
          setLeaseId(null);
          setThreadId(null);
          setMessages([]);
          return;
        }
        setLeaseId(lease.id);
        setPropertyId(lease.property_id || null);
        setPropertyTitle(lease.properties?.title || 'Lease');
        peerIdRef.current =
          role === 'tenant' ? lease.properties?.owner_id || null : lease.tenant_id || null;

        if (peerIdRef.current) {
          const { data: peerProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', peerIdRef.current)
            .maybeSingle();
          peerNameRef.current = peerProfile?.full_name || (role === 'tenant' ? 'Landlord' : 'Tenant');
        }

        const { data: tid, error: threadError } = await supabase.rpc('get_or_create_lease_thread', {
          p_lease_id: lease.id,
        });
        if (threadError) throw threadError;
        setThreadId(tid as string);
        await loadMessages(tid as string);
      } catch (err) {
        console.error('Load messages error:', err);
        Alert.alert('Error', 'Failed to load messages for this lease.');
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, [user?.id, resolveLease, loadMessages, role]);

  // Live messages + typing via Realtime
  useEffect(() => {
    if (!threadId || !user?.id) return;

    const channel = supabase
      .channel(`lease-thread:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            sender_id: string;
            body: string;
            created_at: string;
          };
          if (!row?.id) return;

          const mine = row.sender_id === user.id;
          appendMessage({
            id: row.id,
            sender_id: row.sender_id,
            body: row.body,
            created_at: row.created_at,
            profiles: mine
              ? { full_name: user.fullName || null }
              : { full_name: peerNameRef.current },
          });

          if (!mine) {
            setPeerTyping(false);
            if (peerTypingTimerRef.current) {
              clearTimeout(peerTypingTimerRef.current);
              peerTypingTimerRef.current = null;
            }
          }
        }
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const typingUserId = (payload as { user_id?: string } | null)?.user_id;
        if (!typingUserId || typingUserId === user.id) return;
        setPeerTyping(true);
        if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = setTimeout(() => {
          setPeerTyping(false);
          peerTypingTimerRef.current = null;
        }, TYPING_IDLE_MS);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      if (peerTypingTimerRef.current) {
        clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [threadId, user?.id, user?.fullName, appendMessage]);

  const broadcastTyping = useCallback(() => {
    if (!user?.id || !channelRef.current) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    void channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: user.id },
    });
  }, [user?.id]);

  const handleBodyChange = useCallback(
    (text: string) => {
      setBody(text);
      if (text.trim()) broadcastTyping();
    },
    [broadcastTyping]
  );

  const handleSend = async () => {
    if (!user?.id || !threadId || !body.trim()) return;
    const text = body.trim();
    const optimisticId = `local-${Date.now()}`;
    const createdAt = new Date().toISOString();

    try {
      setSending(true);
      setBody('');
      setPeerTyping(false);

      appendMessage({
        id: optimisticId,
        sender_id: user.id,
        body: text,
        created_at: createdAt,
        profiles: { full_name: user.fullName || null },
      });

      const { data: inserted, error } = await supabase
        .from('messages')
        .insert({
          thread_id: threadId,
          sender_id: user.id,
          body: text,
        })
        .select('id, sender_id, body, created_at')
        .single();
      if (error) throw error;

      // Swap optimistic row for the real one (Realtime may also deliver it).
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimisticId);
        if (withoutOptimistic.some((m) => m.id === inserted.id)) return withoutOptimistic;
        return [
          ...withoutOptimistic,
          {
            ...inserted,
            profiles: { full_name: user.fullName || null },
          },
        ];
      });

      await supabase
        .from('message_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', threadId);

      if (role === 'tenant' && propertyId && leaseId) {
        try {
          await notifyPropertyOwner({
            propertyId,
            type: 'message',
            title: 'New lease message',
            body: text.length > 80 ? `${text.slice(0, 77)}...` : text,
            entityType: 'message_thread',
            entityId: leaseId,
          });
        } catch (notifyErr) {
          console.error('Notify message peer error:', notifyErr);
        }
      } else if (peerIdRef.current && leaseId) {
        try {
          await notifyUser({
            userId: peerIdRef.current,
            type: 'message',
            title: 'New lease message',
            body: text.length > 80 ? `${text.slice(0, 77)}...` : text,
            entityType: 'message_thread',
            entityId: leaseId,
          });
        } catch (notifyErr) {
          console.error('Notify message peer error:', notifyErr);
        }
      }

      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (err: any) {
      console.error('Send message error:', err);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setBody(text);
      Alert.alert('Error', err.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  if (!leaseId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.empty}>
          {role === 'tenant'
            ? 'You need an active or pending lease to message your landlord.'
            : 'Select a tenant conversation from Messages, or open Message on a lease.'}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{propertyTitle}</Text>
        <Text style={styles.headerHint}>Lease conversation with your {role === 'tenant' ? 'landlord' : 'tenant'}</Text>
      </View>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet. Say hello.</Text>}
        renderItem={({ item }) => {
          const mine = item.sender_id === user?.id;
          return (
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              {!mine ? (
                <Text style={styles.sender}>{item.profiles?.full_name || 'User'}</Text>
              ) : null}
              <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
              <Text style={[styles.time, mine && styles.timeMine]}>
                {new Date(item.created_at).toLocaleString('en-KE', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          );
        }}
      />
      {peerTyping ? (
        <Text style={styles.typingHint}>{peerNameRef.current} is typing…</Text>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={body}
          onChangeText={handleBodyChange}
          placeholder="Write a message…"
          placeholderTextColor="#64748B"
          multiline
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={sending || !body.trim()}>
          {sending ? <ActivityIndicator color="#0F172A" /> : <Send size={18} color="#0F172A" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  centered: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#334155' },
  headerTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '700' },
  headerHint: { color: '#64748B', fontSize: 12, marginTop: 2 },
  list: { padding: 16, flexGrow: 1 },
  empty: { color: '#94A3B8', textAlign: 'center', marginTop: 40, lineHeight: 20 },
  bubble: {
    maxWidth: '82%',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: '#38BDF8' },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155' },
  sender: { color: '#94A3B8', fontSize: 11, marginBottom: 4 },
  bubbleText: { color: '#F8FAFC', fontSize: 14, lineHeight: 20 },
  bubbleTextMine: { color: '#0F172A' },
  time: { color: '#64748B', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(15,23,42,0.65)' },
  typingHint: {
    color: '#94A3B8',
    fontSize: 12,
    fontStyle: 'italic',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendBtn: {
    backgroundColor: '#38BDF8',
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
