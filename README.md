# Academic Intelligence Platform

A Next.js starter aligned to your Module 1 SRS for an academic SaaS platform:

- superadmin tenant provisioning
- tenant owner and tenant admin setup
- user directory and invitation monitoring
- login, invitation activation, social login gating, and password flows
- intelligent dashboard and business intelligence surfaces
- Prisma data model for tenant, identity, access, deferred import, and audit domains

## Stack in this starter

- Next.js App Router
- Tailwind CSS
- Prisma
- PostgreSQL-ready schema
- React Hook Form + Zod
- TanStack Table
- Recharts
- Lucide icons
- XLSX installed for later bulk-import work

## Routes

- `/` overview and module map
- `/superadmin` tenant provisioning shell
- `/tenant-admin` user directory and policy surface
- `/imports` deferred bulk-upload lane with schema readiness
- `/insights` business intelligence and AI briefing page
- `/login`, `/forgot-password`, `/reset-password`, `/activate/[token]`, `/change-password`
- `/workspace` protected tenant-user landing page

## Prisma domain coverage

The schema models:

- `Tenant`
- `TenantPolicy`
- `User`
- `Membership`
- `Invitation`
- `UploadBatch`
- `UploadRow`
- `AuditLog`

This keeps tenant state, entitlement state, user state, membership state, and future import batch state separate, which is important for deterministic access control.

## Local setup

1. Update `DATABASE_URL` in `.env`.
2. Generate the Prisma client:

```bash
npm run db:generate
```

3. Run a migration after your database is available:

```bash
npm run db:migrate
```

4. Start the app:

```bash
npm run dev
```

5. Bootstrap the first superadmin:

```bash
npm run bootstrap:superadmin
```

## Recommended next integrations

These are the next modules I would plug in after this foundation:

- `Auth.js` with Prisma adapter for credentials plus Google and Microsoft login
- `Resend` for invitation, reset-password, and suspension notifications
- `Inngest` or `BullMQ` for background invitation sends, batch provisioning, and audit fan-out
- `Sentry` for production observability
- optional LLM integration for explainers, validation summaries, and dashboard narrative

## Notes

- The live bulk-import UI is intentionally deferred.
- The schema already preserves the upload batch and row staging model for later.
- Imported users should still resolve through the same `User`, `Membership`, `Invitation`, and `AuditLog` pipeline as manually provisioned users.
- Google and Microsoft sign-in are enabled only when the user is already pre-provisioned and the provider env vars are configured.
