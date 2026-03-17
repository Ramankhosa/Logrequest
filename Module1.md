# Module 1

Implemented now:

- Next.js + Tailwind app shell for Module 1
- Prisma schema for `Tenant`, `TenantPolicy`, `User`, `Membership`, `Invitation`, `AuditLog`, `UploadBatch`, and `UploadRow`
- superadmin tenant provisioning screen with stepwise wizard
- tenant admin user directory, invitation monitoring, and identity policy views
- insights dashboard with BI-style charts and operational summaries
- deferred bulk-import lane, while keeping schema support for future imported users
- login and authentication flows for all users
- invitation activation flow
- email-based forgot password and reset password flow
- authenticated change-password flow
- social login gate for pre-provisioned Google and Microsoft identities
- protected routes for superadmin, tenant admin, and tenant users
- bootstrap script for first superadmin creation

Current routes:

- `/`
- `/login`
- `/forgot-password`
- `/reset-password`
- `/activate/[token]`
- `/change-password`
- `/superadmin`
- `/tenant-admin`
- `/imports`
- `/insights`
- `/workspace`

Important note:

- Bulk import UI is intentionally deferred for now
- Bulk-imported users can still be added later through the same `User` + `Membership` + `Invitation` model

Local Postgres default used here:

- user: `postgres`
- password: `123`
- host: `localhost`
- database: `logrequest`

Bootstrap command:

- `npm run bootstrap:superadmin`
