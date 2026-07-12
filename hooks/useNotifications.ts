import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { getUnreadCount } from '../lib/notifications';

export function useNotifications() {
  const { user } = useUser();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refreshUnreadCount = useCallback(async () => {
    if (!user?.id) {
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { count, error } = await getUnreadCount(user.id);
      if (error) throw error;
      setUnreadCount(count ?? 0);
    } catch (err) {
      console.error('Unread count fetch error:', err);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    refreshUnreadCount();
  }, [refreshUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      refreshUnreadCount();
    }, [refreshUnreadCount]),
  );

  return { unreadCount, loading, refreshUnreadCount };
}
