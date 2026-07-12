# admin-delete-user

Permanently deletes a Clerk user and the matching Supabase `profiles` row
(related rows cascade via foreign keys).

Authorization: admins only. Cannot delete yourself or other admin profiles.

## Deploy

```bash
supabase functions deploy admin-delete-user
```

Requires the same `CLERK_SECRET_KEY` secret as `admin-create-user`.
