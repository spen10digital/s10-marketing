# ADR 0015: Aurora behind the Data API, two roles, forced RLS with narrow definer policies

- **Status:** Accepted
- **Date:** 2026-11-03
- **Milestone:** M1.2

## Decision
- **Cluster:** Aurora PostgreSQL 16 Serverless v2, 0–4 ACU, auto-pause after 10 min. The RDS Data API is on, storage is encrypted, and deletion protection plus 14-day backups apply in prod. Aurora requires a VPC, so it gets one with **isolated subnets only**: no internet gateway, no NAT, a security group with no inbound rules, and nothing else inside. ADR 0010 still holds for app components; only the database sits in a VPC.
- **Roles:**
  - `app_owner` is the cluster master user and is used only by `pnpm db:migrate --aws`.
  - `app_rw` is used by the app and workers, with no `BYPASSRLS`. Its password comes from a CDK-generated secret and is applied by the migration runner. The web role can read **only** the `app_rw` secret.
- **Context:** every request runs `withDbContext`. Inside one transaction, it first runs `set_config('app.user_id' | 'app.actor' | 'app.org_id', …, true)`. `pnpm db:verify-context --env dev` proves this on the real Data API.
- **RLS:** enabled and forced on every table. Policies target `app_rw`. A few helper functions must see across tenants by design: membership checks, `register_user`, `resolve_user`, `create_organization` and the audit trigger. They are `SECURITY DEFINER` functions owned by `app_owner` with an empty `search_path`. Because forced RLS also binds the table owner in Aurora, `app_owner` gets narrow `to app_owner` policies on exactly the tables those helpers touch. Locally `app_owner` is a NOLOGIN role that owns the helpers, so local tests reproduce Aurora's behaviour.
- **Privileges:**
  - Inserts are table-level, and RLS `with check` pins `org_id` and `created_by`.
  - Updates are column-level, so `org_id` can never change.
  - No deletes in M1.2: brands are archived, voice versions are append-only, audit logs are written only by the trigger.
  - Organization membership is read-only for the app until invitations exist.
- **Migrations:** plain SQL, split into single statements (the Data API runs one per call), applied in one transaction per file and checksummed in `app.schema_migrations`.

## Why
Scale-to-zero cost, no network path to the database, and tenant isolation enforced by Postgres rather than by application code alone.

## Consequences
- Secrets aren't rotated automatically: rotation Lambdas need a network path to the cluster. Rotate by hand (runbook).
- Lists are stored as `jsonb` arrays, because the Data API cannot bind array parameters.
- Org slugs are global. On a clash `create_organization` appends a random suffix rather than revealing that another tenant uses the name.
