// Edge Function: admin-create-user
//
// Creates a complete user account (Clerk identity + Supabase profile) on behalf
// of an authorized caller. The caller sets the email, username, role and
// password directly; the new user can then log in immediately with those
// credentials.
//
// Authorization:
// - Admins may create accounts with any allowed role.
// - Landlords may create accounts only with the `tenant` role.
//
// Security model:
// - The gateway's verify_jwt check is disabled (it only accepts JWTs signed by
//   Supabase itself, not Clerk tokens), so this function verifies the caller's
//   Clerk JWT signature against the instance's JWKS before doing anything.
// - We additionally confirm the caller's profile role using the service-role
//   client before creating anything.
//
// Required secrets (set via `supabase secrets set`):
//   CLERK_SECRET_KEY
// Auto-injected by the Edge runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as jose from 'jsr:@panva/jose@6';

const ALLOWED_ROLES = ['admin', 'finance', 'tenant', 'client', 'landlord'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

// Clerk instance JWKS, fetched once via the Backend API and cached for the
// lifetime of the isolate. Used to verify the caller's Clerk session JWT.
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

// Verifies the Clerk JWT signature and returns the `sub` (Clerk user id), or
// null when the token is missing/invalid/expired.
async function verifyCallerToken(
  token: string,
  clerkSecret: string,
): Promise<string | null> {
  try {
    const jwks = await getClerkJwks(clerkSecret);
    const { payload } = await jose.jwtVerify(token, jwks);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch (err) {
    console.error('[admin-create-user] JWT verification failed:', err);
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
    console.error('[admin-create-user] Missing required environment variables.');
    return json({ error: 'Server is not configured correctly.' }, 500);
  }

  // --- Authenticate + authorize the caller ---
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

  const callerRole = callerProfile?.role as string | undefined;
  const isAdmin = callerRole === 'admin';
  const isLandlord = callerRole === 'landlord';

  if (callerError || (!isAdmin && !isLandlord)) {
    return json({ error: 'Only admins and landlords can create user accounts.' }, 403);
  }

  // --- Validate input ---
  let body: {
    email?: string;
    username?: string;
    role?: string;
    password?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const username = (body.username ?? '').trim();
  const role = (body.role ?? '').trim();
  const password = body.password ?? '';

  if (!EMAIL_RE.test(email)) {
    return json({ error: 'Please provide a valid email address.' }, 400);
  }
  if (!username) {
    return json({ error: 'Please provide a username.' }, 400);
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return json({ error: 'Please select a valid role.' }, 400);
  }
  // Landlords may only provision tenant accounts — never staff/admin roles.
  if (isLandlord && role !== 'tenant') {
    return json({ error: 'Landlords can only create tenant accounts.' }, 403);
  }
  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters.' }, 400);
  }

  // --- Create the Clerk user (email marked verified via Backend API) ---
  // The Clerk instance requires a `username` attribute, and Clerk usernames
  // only allow letters, digits, '-' and '_'. The admin-entered "username" is
  // really a display name (e.g. "Jane Doe"), so we derive a valid Clerk
  // username from it and pass the name itself as first/last name.
  const nameParts = username.split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ');

  let clerkUsername = username.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
  if (clerkUsername.length < 4) {
    clerkUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }
  if (clerkUsername.length < 4) {
    clerkUsername = `user_${Date.now().toString(36)}`;
  }
  clerkUsername = clerkUsername.slice(0, 64);

  async function createClerkUser(candidateUsername: string) {
    const res = await fetch(CLERK_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clerkSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: [email],
        password,
        username: candidateUsername,
        first_name: firstName,
        ...(lastName ? { last_name: lastName } : {}),
      }),
    });
    return { res, data: await res.json() };
  }

  let clerkUserId: string;
  try {
    let { res: clerkRes, data: clerkData } = await createClerkUser(clerkUsername);

    // If the derived username is already taken (but the email is not), retry
    // once with a random suffix.
    if (!clerkRes.ok) {
      const errors: Array<{ code?: string; meta?: { param_name?: string } }> =
        clerkData?.errors ?? [];
      const usernameTaken = errors.some(
        (e) => e.code === 'form_identifier_exists' && e.meta?.param_name === 'username',
      );
      const emailTaken = errors.some(
        (e) => e.code === 'form_identifier_exists' && e.meta?.param_name === 'email_address',
      );
      if (usernameTaken && !emailTaken) {
        const suffixed = `${clerkUsername.slice(0, 59)}_${Math.floor(1000 + Math.random() * 9000)}`;
        ({ res: clerkRes, data: clerkData } = await createClerkUser(suffixed));
      }
    }

    if (!clerkRes.ok) {
      const clerkErr = clerkData?.errors?.[0];
      const code = clerkErr?.code as string | undefined;
      let message = clerkErr?.message || 'Failed to create the account.';
      if (code === 'form_identifier_exists') {
        message = 'An account with this email already exists.';
      } else if (code === 'form_password_pwned') {
        message = 'That password has been found in a data breach. Choose another.';
      } else if (code === 'form_password_length_too_short') {
        message = 'Password is too short.';
      } else if (clerkErr?.long_message) {
        message = clerkErr.long_message;
      }
      console.error('[admin-create-user] Clerk error:', JSON.stringify(clerkData));
      return json({ error: message }, 400);
    }

    clerkUserId = clerkData?.id;
    if (!clerkUserId) {
      console.error('[admin-create-user] Clerk returned no user id:', JSON.stringify(clerkData));
      return json({ error: 'Account creation failed unexpectedly.' }, 500);
    }
  } catch (err) {
    console.error('[admin-create-user] Clerk request failed:', err);
    return json({ error: 'Failed to reach the identity provider.' }, 502);
  }

  // --- Create the Supabase profile (id maps to the Clerk user id) ---
  const { error: profileError } = await admin.from('profiles').insert({
    id: clerkUserId,
    full_name: username,
    email,
    phone: null,
    role,
  });

  if (profileError) {
    console.error('[admin-create-user] Profile insert failed:', profileError);
    // Roll back the Clerk user so we don't leave an orphaned identity.
    try {
      await fetch(`${CLERK_API}/${clerkUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${clerkSecret}` },
      });
    } catch (rollbackErr) {
      console.error('[admin-create-user] Clerk rollback failed:', rollbackErr);
    }
    return json({ error: 'Failed to save the user profile.' }, 500);
  }

  return json({ ok: true, userId: clerkUserId, email, role });
});
