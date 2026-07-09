import { supabase } from './supabase';

export interface AuditEntry {
  actorId: string;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Records an entry in the audit_logs table. Failures are swallowed so that
 * logging never blocks or breaks the primary user action. RLS only permits a
 * user to insert rows attributed to themselves (actor_id = their Clerk id).
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail ?? null,
      actor_role: entry.actorRole ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      description: entry.description ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    console.warn('[audit] Failed to record audit entry:', err);
  }
}
