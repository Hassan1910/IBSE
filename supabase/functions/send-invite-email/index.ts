// Edge Function: send-invite-email
//
// After an admin saves a user_invites row, call this to email the invitee
// (via Resend when RESEND_API_KEY is set) and return a shareable signup URL.
//
// Required secrets: CLERK_SECRET_KEY
// Optional: RESEND_API_KEY, RESEND_FROM_EMAIL, APP_SIGNUP_URL
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as jose from 'jsr:@panva/jose@6';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (!res.ok) throw new Error(`Failed to fetch Clerk JWKS (status ${res.status})`);
  cachedJwks = jose.createLocalJWKSet(await res.json());
  return cachedJwks;
}

async function verifyCallerToken(token: string, clerkSecret: string): Promise<string | null> {
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
  const callerId = token ? await verifyCallerToken(token, clerkSecret) : null;
  if (!callerId) return json({ error: 'Unauthorized.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: caller } = await admin.from('profiles').select('role').eq('id', callerId).single();
  if (caller?.role !== 'admin' && caller?.role !== 'landlord') {
    return json({ error: 'Only admins and landlords can send invites.' }, 403);
  }

  let body: { email?: string; role?: string; fullName?: string | null };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const role = (body.role ?? 'client').trim();
  const fullName = (body.fullName ?? '').trim();
  if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email.' }, 400);

  const signupBase =
    Deno.env.get('APP_SIGNUP_URL')?.replace(/\/$/, '') ||
    'https://ibsahomes.com/signup';
  const signupUrl = `${signupBase}?email=${encodeURIComponent(email)}`;

  let emailSent = false;
  let emailError: string | null = null;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'IBSA Homes <onboarding@resend.dev>';

  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject: 'You are invited to IBSA Homes',
          html: `
            <p>Hello${fullName ? ` ${fullName}` : ''},</p>
            <p>You have been invited to join IBSA Homes as <strong>${role}</strong>.</p>
            <p><a href="${signupUrl}">Create your account</a> using this email address (${email}).</p>
            <p>If you did not expect this invite, you can ignore this message.</p>
          `,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        emailError = `Resend failed (${res.status}): ${errBody}`;
      } else {
        emailSent = true;
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
    }
  }

  return json({
    ok: true,
    email,
    role,
    signupUrl,
    emailSent,
    emailError,
    message: emailSent
      ? 'Invite email sent.'
      : 'Invite saved. Share the signup link with the user (email provider not configured or send failed).',
  });
});
