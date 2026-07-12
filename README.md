# IBSE (IBSA Homes)

Property / estate operations mobile app for admins, landlords, clients, and tenants.

Built with **Expo**, **TypeScript**, **Clerk**, and **Supabase**.

## Features

- Role-based experiences for admin, landlord, client, and tenant
- Clerk authentication with secure token storage
- Supabase-backed data for properties, charges, documents, and messaging
- Real-time messaging support
- Document handling and operational workflows for estate management

## Tech stack

| Layer | Tools |
|-------|--------|
| App | Expo 54, Expo Router, React Native |
| Language | TypeScript |
| Auth | Clerk (`@clerk/clerk-expo`) |
| Data | Supabase (Postgres, Realtime, Storage) |
| State | TanStack Query |

## Getting started

### Prerequisites

- Node.js 20+
- Expo CLI / Expo Go (or a device/emulator)
- Clerk and Supabase projects configured

### Setup

```bash
pnpm install
# or: npm install
```

Copy environment variables for Clerk and Supabase into your local env file (see `.env` / Expo config in the project), then:

```bash
pnpm start
# or: npx expo start
```

## Project structure

```
app/           # Expo Router screens (admin, landlord, client, tenant, auth)
components/    # Shared UI
lib/           # Clients and helpers (Clerk, Supabase, etc.)
supabase/      # Migrations and edge functions
```

## License

See [LICENSE](./LICENSE).
