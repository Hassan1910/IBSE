# admin-reset-password

Forces a password reset for a user by marking their Clerk password as
compromised and revoking all sessions. The user must set a new password on
their next sign-in.

Authorization: admins only.

## Deploy

```bash
supabase functions deploy admin-reset-password
```

Requires the same `CLERK_SECRET_KEY` secret as `admin-create-user`.
