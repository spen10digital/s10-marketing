# ADR 0002: Multi-tenant with Postgres RLS from the first migration

- **Status:** Accepted
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
Organization → brand tenancy. Every tenant table has `org_id`, `unique(org_id, id)`, composite FKs and row-level security that is enabled and forced. All access runs as `app_rw` inside `withDbContext`.

## Why
Retro-fitting tenancy before the public SaaS phase would be far more expensive than doing it now (04, "Changes").

## Consequences
Every table needs policies and isolation tests; `set_config` persistence in Data API transactions must be verified in M1.2.
