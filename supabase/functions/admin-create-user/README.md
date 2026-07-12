# admin-create-user

Edge Function that lets an authorized caller create a complete user account
(Clerk identity + Supabase `profiles` row) with an email, username, role and
password. The new user can log in immediately with those credentials and later
change their password.

Authorization:
- Admins may create any allowed role.
- Landlords may create `tenant` accounts only.

## Prerequisites

- Supabase CLI installed and logged in (`supabase login`).
- Project linked (or pass `--project-ref` on each command):
  ```bash
  supabase link --project-ref <your-project-ref>
  ```

## Set the required secret

The function needs your Clerk **secret** key (starts with `sk_`). Never put this
in the mobile app / `EXPO_PUBLIC_*` env.

```bash
supabase secrets set CLERK_SECRET_KEY=sk_live_xxx   # or sk_test_xxx
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
Edge runtime — do not set them manually.

## Deploy

```bash
supabase functions deploy admin-create-user
```

## Notes

- The gateway's `verify_jwt` check is disabled (it only accepts JWTs signed by
  Supabase itself and rejects Clerk session tokens with a 401). Instead, the
  function verifies the Clerk JWT signature against the instance's JWKS, then
  authorizes the caller by verifying their `profiles.role` is `admin` or
  `landlord` (landlords restricted to `tenant` role) using the service-role
  client.
- Emails created through the Clerk Backend API are marked verified, so password
  login works right away.
- If the Supabase profile insert fails, the just-created Clerk user is rolled
  back to avoid orphaned identities.
