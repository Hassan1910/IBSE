// Edge Function: dispatch-push
//
// Sends Expo push notifications to a user's registered device tokens.
// Callable by any authenticated user (for their own ops notifications) or
// with service-side usage via Clerk-authenticated staff.
//
// Secrets: CLERK_SECRET_KEY
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

async function verifyCaller(token: string, clerkSecret: string): Promise<string | null> {
  try {
    const jwks = await getClerkJwks(clerkSecret);
    const { payload } = await jose.jwtVerify(token, jwks);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const clerkSecret = Deno.env.get('CLERK_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!clerkSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server is not configured correctly.' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const callerId = token ? await verifyCaller(token, clerkSecret) : null;
  if (!callerId) return json({ error: 'Unauthorized.' }, 401);

  let body: {
    userId?: string;
    userIds?: string[];
    title?: string;
    body?: string;
    data?: Record<string, string>;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const title = (body.title ?? '').trim();
  const messageBody = (body.body ?? '').trim();
  const targets = [
    ...(body.userId ? [body.userId] : []),
    ...(Array.isArray(body.userIds) ? body.userIds : []),
  ].filter(Boolean);

  if (!title || !messageBody || !targets.length) {
    return json({ error: 'userId(s), title, and body are required.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tokens } = await admin
    .from('device_push_tokens')
    .select('token')
    .in('user_id', targets);

  const messages = (tokens || []).map((t) => ({
    to: t.token,
    title,
    body: messageBody,
    data: body.data || {},
    sound: 'default',
  }));

  if (!messages.length) return json({ ok: true, sent: 0 });

  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
    if (res.ok) sent += chunk.length;
    else console.error('[dispatch-push] Expo error:', await res.text());
  }

  return json({ ok: true, sent });
});
