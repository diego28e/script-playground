# Code Challenge Platform

A Next.js application for coding challenges deployed on AWS Amplify with Supabase PostgreSQL.

## Database Architecture

This project uses a **hybrid approach** for database management:

- **Prisma**: Schema modeling, migrations, and type generation (development only)
- **Supabase JS Client**: Runtime queries in production (edge/serverless compatible)

### Why This Approach?

- Prisma's `pg.Pool` connections don't work in AWS Amplify's edge runtime
- Supabase client uses HTTP/REST API, fully compatible with serverless environments
- We keep Prisma for its superior DX: schema modeling, migrations, and type safety

## Development Workflow

### 1. Schema Changes

Edit `prisma/schema.prisma` and run migrations:

```bash
npx prisma migrate dev --name your_migration_name
```

This creates migration files and updates your local database.

### 2. Generate Types

After schema changes, regenerate Prisma types:

```bash
npx prisma generate
```

### 3. Deploy Schema to Supabase

Prisma migrations automatically apply to your Supabase database (via `DIRECT_URL`).

### 4. Runtime Queries

All runtime code uses Supabase client:

```typescript
import { supabase } from "@/lib/supabase";

const { data, error } = await supabase
  .from("challenge")
  .select("*")
  .eq("id", challengeId);
```

## Environment Variables

Required for local development and production:

```env
# Supabase (Runtime)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Prisma (Migrations Only)
DATABASE_URL=postgresql://...:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://...:5432/postgres

# Auth
BETTER_AUTH_SECRET=your-secret
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deployment

Deploy to AWS Amplify:

1. Push code to repository
2. Amplify auto-builds and deploys
3. Ensure environment variables are set in Amplify console

## Key Files

- `prisma/schema.prisma` - Database schema (Prisma)
- `lib/supabase.ts` - Supabase client for runtime queries
- `lib/prisma.ts` - Prisma client (better-auth only)
- `lib/database.types.ts` - TypeScript types for Supabase
- `actions/*.ts` - Server actions using Supabase client

## Important Notes

- **Prisma client** (`lib/prisma.ts`) is ONLY used by better-auth adapter
- **All application queries** use Supabase client (`lib/supabase.ts`)
- This ensures edge/serverless compatibility on AWS Amplify
