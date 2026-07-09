import { useCallback } from 'react';
import { useUser } from '@clerk/clerk-expo';
import { logAudit } from '../lib/audit';
import { useRole } from './useRole';

type LogArgs = {
  action: string;
  entityType?: string;
  entityId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Convenience hook that records audit entries attributed to the currently
 * signed-in user. Use inside admin screens for create/update/delete actions.
 */
export function useAudit() {
  const { user } = useUser();
  const { role } = useRole();

  const log = useCallback(
    (args: LogArgs) => {
      if (!user?.id) return;
      return logAudit({
        actorId: user.id,
        actorEmail: user.primaryEmailAddress?.emailAddress ?? null,
        actorRole: role,
        ...args,
      });
    },
    [user?.id, user?.primaryEmailAddress?.emailAddress, role],
  );

  return { log };
}
