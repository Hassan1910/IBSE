// Edge Function: scheduled-alerts
//
// Runs rent_due / lease_expiry notification generation via RPC, then fans out
// Expo push notifications for newly created alerts when tokens exist.
//
// Auth: Bearer CRON_SECRET (preferred for schedulers) OR admin Clerk JWT.
// Secrets: CRON_SECRET (optional), CLERK_SECRET_KEY (for admin calls)
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as jose from 'jsr:@panva/jose@6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

let cachedJwks: ReturnType<typeof jose.createLocalJWKSet> | null = null;

async function getClerkJwks(clerkSecret: string) {
  if (cachedJwks) return cachedJwks;
  const res = await fetch('https://api.clerk.com/v1/jwks', {
    headers: { Authorization: `Bearer ${clerkSecret}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Clerk JWKS`);
  cachedJwks = jose.createLocalJWKSet(await res.json());
  return cachedJwks;
}

async function verifyClerk(token: string, clerkSecret: string): Promise<string | null> {
  try {
    const jwks = await getClerkJwks(clerkSecret);
    const { payload } = await jose.jwtVerify(token, jwks);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

async function sendExpoPush(
  messages: Array<{ to: string; title: string; body: string; data?: Record<string, string> }>,
) {
  if (!messages.length) return { sent: 0 };
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.error('[scheduled-alerts] Expo push failed:', await res.text());
    return { sent: 0, error: true };
  }
  return { sent: messages.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const clerkSecret = Deno.env.get('CLERK_SECRET_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server is not configured correctly.' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  let authorized = false;
  if (cronSecret && token === cronSecret) {
    authorized = true;
  } else if (clerkSecret && token) {
    const callerId = await verifyClerk(token, clerkSecret);
    if (callerId) {
      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data } = await admin.from('profiles').select('role').eq('id', callerId).single();
      authorized = data?.role === 'admin';
    }
  }

  if (!authorized) return json({ error: 'Unauthorized.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: result, error } = await admin.rpc('run_scheduled_alerts');
  if (error) {
    console.error('[scheduled-alerts] RPC failed:', error);
    return json({ error: error.message }, 500);
  }

  // Fan-out push for today's rent_due / lease_expiry notifications
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: recent } = await admin
    .from('notifications')
    .select('user_id, title, body, type, entity_id')
    .in('type', ['rent_due', 'lease_expiry'])
    .gte('created_at', todayStart.toISOString())
    .limit(500);

  const userIds = [...new Set((recent || []).map((n) => n.user_id))];
  let pushSent = 0;
  if (userIds.length) {
    const { data: tokens } = await admin
      .from('device_push_tokens')
      .select('user_id, token')
      .in('user_id', userIds);

    const byUser = new Map<string, string[]>();
    for (const row of tokens || []) {
      const list = byUser.get(row.user_id) || [];
      list.push(row.token);
      byUser.set(row.user_id, list);
    }

    const messages: Array<{ to: string; title: string; body: string; data?: Record<string, string> }> = [];
    for (const n of recent || []) {
      for (const to of byUser.get(n.user_id) || []) {
        messages.push({
          to,
          title: n.title,
          body: n.body,
          data: { type: n.type, entityId: n.entity_id || '' },
        });
      }
    }
    // Expo accepts batches of ~100
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const r = await sendExpoPush(chunk);
      pushSent += r.sent || 0;
    }
  }

  return json({ ok: true, alerts: result, pushSent });
});
