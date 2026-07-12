// Edge Function: admin-reset-password
//
// Forces a password reset for a target user by marking their password as
// compromised in Clerk (revokes sessions). The user must set a new password
// on their next sign-in.
//
// Authorization: admins only.
//
// Required secrets: CLERK_SECRET_KEY
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as jose from 'jsr:@panva/jose@6';

const CLERK_API = 'https://api.clerk.com/v1/users';

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
  if (!res.ok) {
    throw new Error(`Failed to fetch Clerk JWKS (status ${res.status})`);
  }
  cachedJwks = jose.createLocalJWKSet(await res.json());
  return cachedJwks;
}

async function verifyCallerToken(
  token: string,
  clerkSecret: string,
): Promise<string | null> {
  try {
    const jwks = await getClerkJwks(clerkSecret);
    const { payload } = await jose.jwtVerify(token, jwks);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch (err) {
    console.error('[admin-reset-password] JWT verification failed:', err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const clerkSecret = Deno.env.get('CLERK_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!clerkSecret || !supabaseUrl || !serviceRoleKey) {
    console.error('[admin-reset-password] Missing required environment variables.');
    return json({ error: 'Server is not configured correctly.' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const callerId = token ? await verifyCallerToken(token, clerkSecret) : null;
  if (!callerId) {
    return json({ error: 'Unauthorized: invalid or expired session token.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerProfile, error: callerError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single();

  if (callerError || callerProfile?.role !== 'admin') {
    return json({ error: 'Only admins can force a password reset.' }, 403);
  }

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const userId = (body.userId ?? '').trim();
  if (!userId) {
    return json({ error: 'Please provide a userId.' }, 400);
  }
  if (userId === callerId) {
    return json({ error: 'Use your profile screen to change your own password.' }, 400);
  }

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (targetError || !target) {
    return json({ error: 'User profile not found.' }, 404);
  }

  try {
    const res = await fetch(`${CLERK_API}/${userId}/password/set_compromised`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clerkSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ revoke_all_sessions: true }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message =
        data?.errors?.[0]?.long_message ||
        data?.errors?.[0]?.message ||
        'Failed to force password reset.';
      console.error('[admin-reset-password] Clerk error:', JSON.stringify(data));
      return json({ error: message }, res.status >= 500 ? 502 : 400);
    }

    return json({
      ok: true,
      userId,
      email: target.email,
      fullName: target.full_name,
    });
  } catch (err) {
    console.error('[admin-reset-password] Clerk request failed:', err);
    return json({ error: 'Failed to reach the identity provider.' }, 502);
  }
});
