# Code Challenge Platform

A Next.js 16 application for coding challenges deployed on AWS Amplify with Supabase PostgreSQL.

## Database Architecture

This project uses **Prisma** for all database operations:

- **Schema modeling** with `prisma/schema.prisma`
- **Type-safe queries** with Prisma Client
- **Database migrations** with Prisma Migrate
- **Connection pooling** via `pg.Pool` with SSL

### Runtime Configuration

- **Node.js runtime** required for Prisma (configured with `export const runtime = 'nodejs'`)
- **PrismaPg adapter** for PostgreSQL connection pooling
- **Supabase PostgreSQL** as database provider

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

All queries use Prisma Client:

```typescript
import { prisma } from "@/lib/prisma";

const challenges = await prisma.challenge.findMany({
  where: { id: challengeId },
  include: { labels: true },
});
```

## Environment Variables

Required for local development and production:

```env
# Database (Prisma)
DATABASE_URL=postgresql://user:password@host:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://user:password@host:5432/postgres

# Auth (Better Auth)
BETTER_AUTH_SECRET=your-secret-key
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# OAuth (Google)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

**Note**: `DATABASE_URL` uses port 6543 (PgBouncer) for connection pooling. `DIRECT_URL` uses port 5432 for migrations.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deployment

### AWS Amplify Setup

1. **Connect repository** to AWS Amplify
2. **Set environment variables** in Amplify console:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `BETTER_AUTH_SECRET`
   - `BETTER_AUTH_URL` (production URL)
   - `NEXT_PUBLIC_APP_URL` (production URL)
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
3. **Deploy**: Push to main branch triggers auto-deployment

### Build Configuration

- Next.js 16 with Turbopack (dev) and Webpack (production)
- Prisma Client generated during build
- Node.js runtime for all database operations
- Edge runtime for middleware only

## Key Files

- `prisma/schema.prisma` - Database schema definition
- `lib/prisma.ts` - Prisma client with PgBouncer connection pooling
- `lib/auth.ts` - Better Auth configuration with Prisma adapter
- `actions/*.ts` - Server actions using Prisma Client
- `app/**/page.tsx` - Pages with `export const runtime = 'nodejs'`
- `middleware.ts` - Edge-compatible auth middleware (cookie checks only)

## Architecture Decisions

### Why Prisma-Only?

- **Type safety**: Full TypeScript support with generated types
- **Developer experience**: Intuitive API and excellent tooling
- **Migrations**: Version-controlled schema changes
- **Better Auth integration**: Native Prisma adapter support

### Why Node.js Runtime?

- Prisma requires Node.js runtime (uses `pg.Pool`)
- All pages/routes using Prisma must export `runtime = 'nodejs'`
- Middleware stays edge-compatible (no database calls)

### Production Considerations

- **Connection pooling**: PgBouncer (port 6543) handles connection limits
- **SSL required**: Supabase requires SSL connections
- **Environment variables**: Must be set in AWS Amplify console
- **Build time**: Prisma generates client during build process
