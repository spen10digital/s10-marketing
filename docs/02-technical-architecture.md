# 02 — Technical Architecture (AWS-first)

**Project:** S10/Marketing (working name)
**Prepared:** 2026-10-28 · **Revision 2:** AWS-first stack at the owner's request (replaces the Supabase/Vercel/Resend design in revision 1)
**Status:** Proposed — review before M1.1 · **2026-11-01:** web hosting moved to Vercel (ADR 0012); everything else unchanged

---

## 1. Principles

1. **AWS for everything AWS offers.** Hosting, database, auth, jobs, storage, email, AI, secrets, monitoring and backups run on AWS. Non-AWS services are used only where AWS has no equivalent: **GitHub** (source), **Stripe** (subscriptions), **Meta** (the platform we publish to).
2. **Serverless and scale-to-zero by default** — a solo-developer internal tool should cost little when idle and need no servers to patch.
3. **No VPC networking unless required.** Every component talks to AWS over IAM-authenticated HTTPS (RDS Data API, SQS, Scheduler, Bedrock, KMS). This avoids NAT Gateway charges and the networking complexity that comes with Lambdas in a VPC.
4. **Multi-tenant from the first migration**, with Postgres row-level security enforced on every request.
5. **The database is the source of truth** for post and job state; AWS schedulers and queues only *trigger* work.
6. **Infrastructure as code** (AWS CDK in TypeScript) — nothing important is click-configured.
7. **Humans approve by default;** external content is untrusted data; secrets never leave the server side.

---

## 2. High-level architecture

```
                         ┌──────────── AWS account: s10-marketing-{dev|prod} · region us-east-1 ────────────┐
 Browser ──HTTPS──▶  Vercel (Next.js 16 SSR + streaming, iad1; outside AWS) ── OIDC → IAM web role     │
 (desktop/mobile)      • UI + Server Actions + Route Handlers                                              │
        │              • compute role (IAM) ─┬─▶ RDS Data API ──▶ Aurora PostgreSQL Serverless v2 (0–N ACU)│
        │                                    ├─▶ Bedrock (Claude via Converse API)                         │
        │                                    ├─▶ SQS publish-queue  /  EventBridge Scheduler (per-post)    │
        │                                    ├─▶ S3 media bucket (presigned URLs)                          │
        │                                    ├─▶ KMS (Encrypt only)    ├─▶ Secrets Manager (Meta secret)   │
        │                                    └─▶ SES (transactional email)                                 │
        └──▶ Cognito user pool (managed login, MFA, passkeys)                                              │
                                                                                                           │
 EventBridge Scheduler ── at(post time) ──▶ SQS publish-queue ──▶ Lambda publish-worker ──▶ Meta Graph API │
 EventBridge Scheduler ── rate(15 min) ──▶ Lambda sweeper (overdue/orphaned jobs, token checks)            │
 EventBridge Scheduler ── rate(30 min) ──▶ Lambda feed-poller ──▶ SQS ingest-queue ──▶ Lambda ingest      │
 S3 upload event ──▶ Lambda media-processor (validate, strip EXIF, dimensions)                            │
 SQS DLQs + CloudWatch alarms ──▶ SNS ops-alerts ──▶ email/SMS to owner                                    │
                         └─────────────────────────────────────────────────────────────────────────────────┘
 External: GitHub (code, Actions with OIDC → AWS) · Stripe (Phase 4) · Meta Graph API · RSS/Atom/WordPress sites
```

### 2.1 Service choices

| Concern | AWS service | Notes / why |
|---|---|---|
| Web hosting | **Vercel Pro** (owner decision 2026-11-01, ADR 0012) | Git-based deploys and previews per branch, latest Next.js (16) and React (19.3) with **streaming** (used for AI output). Functions run in `iad1` (Washington, D.C.) next to us-east-1. Server code gets AWS credentials through **Vercel OIDC federation** to an IAM role (`VercelAccessStack`) — no access keys. Pro plan required for commercial use. |
| Database | **Aurora PostgreSQL Serverless v2** with **RDS Data API** | Postgres keeps the relational model and RLS. Serverless v2 can **scale to 0 ACU** (auto-pause after ≥5 min idle; ~15 s resume). Data API = HTTPS + IAM, so Vercel functions and Lambda need no VPC, no connection pooling, no RDS Proxy (which would block auto-pause). |
| Auth | **Amazon Cognito user pool** (Essentials tier) | Managed login, email/password, passwordless email codes, passkeys, TOTP MFA; 10,000 MAU free (Lite/Essentials). Future S10/Suite identity hub (§3.4). |
| Scheduling | **EventBridge Scheduler** | One-time `at()` schedule per scheduled post (time-zone aware, delete-after-completion) + recurring `rate()` schedules for sweeper and feed polling. 14M invocations/month free. |
| Queues | **SQS** (standard) + DLQs | Decouples triggers from workers; built-in retries via visibility timeout; DLQ alarms. |
| Workers | **AWS Lambda** (Node.js, arm64) | publish-worker, sweeper, feed-poller, ingest, media-processor, notifier, retention. |
| AI | **Amazon Bedrock** (Claude Sonnet 5.5 for generation / Haiku 5.5 for quick edits — best price/performance — via US cross-Region inference profiles; Converse API, streamed to the browser) | Billed on the AWS invoice; IAM auth (no API keys); Converse API gives one interface across Bedrock models. Images later via a Bedrock image model (e.g. Amazon Nova Canvas). |
| Media | **S3** (private, versioned) | Browser uploads via presigned PUT; Meta fetches via short-lived presigned GET. |
| Email | **Amazon SES** (us-east-1) | Approval requests, failure alerts, digests. Send from a dedicated subdomain (e.g. `notify.spen10.com`) verified in the S10/Marketing prod account, so its reputation is separate from S10/Mail's. |
| Secrets | **Secrets Manager** (Meta app secret, DB credentials for Data API) + **SSM Parameter Store** (non-secret config) | Read at runtime via IAM; never in env vars or code. |
| Token encryption | **AWS KMS** customer managed key | `Encrypt` with an encryption context bound to the tenant; only workers may `Decrypt`. |
| Monitoring | **CloudWatch** Logs/Metrics/Alarms (+ optional X-Ray) + **SNS** | Replaces Sentry; alarms to email/SMS. |
| Backups | **Aurora automated backups with point-in-time restore** (14-day retention) + **AWS Backup** (optional cross-Region copy) + **S3 versioning** | PITR is included (backup storage free up to cluster size). |
| IaC | **AWS CDK (TypeScript)** in `infra/` | Claude-Code-friendly; one language across app and infra. |
| Access | **AWS Organizations + IAM Identity Center** | Separate dev and prod accounts; Claude Code uses short-lived SSO credentials, never long-lived access keys. |
| Edge protection (Phase 4) | **Vercel Firewall** (custom rules, rate limiting, bot protection) | Configure when public signup opens; AWS WAF can't front a Vercel deployment. |

**Stays non-AWS:** Vercel (web hosting, ADR 0012), GitHub (repo; GitHub Actions deploys CDK through OIDC — AWS CodePipeline/CodeBuild is a drop-in alternative if you prefer), Stripe (no AWS subscription-billing equivalent), Meta APIs.

### 2.2 Application libraries

Next.js 16 (App Router) + React 19.3 + TypeScript strict · Tailwind + shadcn/ui · zod · **Drizzle ORM** with its `aws-data-api` Postgres driver in AWS and `node-postgres` locally (same schema and queries) · `@aws-sdk/*` v3 clients · `aws-jwt-verify` (Cognito JWT verification) · `@aws-amplify/adapter-nextjs` (Cognito session cookies in Next.js) · Vitest · Playwright · pino-compatible JSON logging to CloudWatch.

### 2.3 Accounts, regions and environments

| Item | Recommendation |
|---|---|
| AWS Organization | **Decided:** one organization; management account (billing + Identity Center only) → `s10-marketing-dev`, `s10-marketing-prod`; existing S10/Mail account joins the same organization (or already is the management account — move its workloads out of the management account over time); optional `s10-shared` later for S10 Identity |
| Region | **us-east-1 (N. Virginia)** — owner's choice; matches S10/Mail's SES Region. Bedrock US geo inference profiles, SES, Aurora Serverless v2 and Cognito are all available, and ACM certificates for Cognito managed login custom domains must live in us-east-1 anyway. Vercel functions run in `iad1`, the closest Vercel region. |
| Environments | `local` (Docker Postgres + dev AWS account for Bedrock/SQS/S3) · `dev` (Vercel preview deployments incl. `develop`, dev AWS account, publishing disabled) · `prod` (Vercel production from `main`, prod AWS account) |
| Cost guardrails | AWS Budgets alerts, Cost Anomaly Detection, Bedrock usage alarms |

LimitKeep stays on its own stack and accounts; nothing here is shared with it.

---

## 3. Tenancy, authentication and S10/Suite integration

### 3.1 Tenancy model

```
users (Cognito sub) ──< organization_members >── organizations ──< brands ──< (brand-scoped data)
                         role: owner | admin | editor | viewer
```

- **Organization** = tenant and billing unit. Owner's setup: org "S10" (SPEN10, Loot Goblin Labs, S10/Mail) and org "LimitKeep" (LimitKeep).
- Every tenant table carries `org_id` (plus `brand_id` where relevant), `unique (org_id, id)` and composite foreign keys so a row can't reference another tenant's rows.

### 3.2 Authorization layers

1. **Postgres RLS on every tenant table.** The app connects through the Data API as role `app_rw` (no `BYPASSRLS`). Every request runs inside a Data API **transaction** whose first statement is
   `select set_config('app.user_id', :userId, true), set_config('app.actor', 'user', true);`
   Policies call `app.current_user_id()` (`current_setting('app.user_id', true)::uuid`). Workers set `app.actor='system'` and `app.org_id` for the job's org; policies allow system actors only for that org. *(⚠️ Verify in M1.2 that `set_config(..., true)` persists across statements in a Data API transaction — it should, as a transaction is pinned to one connection. Fallback: pass `org_id`/`user_id` as explicit parameters to `security definer` functions.)*
2. **Domain-service checks** (`assertCan(user, 'post.approve', brand)`) for actions.
3. **IAM least privilege per component:** the web compute role may `kms:Encrypt` but not `Decrypt`; only the publish-worker role may `kms:Decrypt`; only the web role and sweeper may `scheduler:CreateSchedule`.
4. **KMS encryption context** `{org_id, connection_id}` on every token: a ciphertext copied into another tenant's row cannot be decrypted.
5. **Never trust client-supplied `org_id`**; derive it from membership.

### 3.3 Authentication now

- Cognito **managed login** (OAuth 2.0 authorization code + PKCE) on a custom domain (e.g. `auth.spen10.com`), email+password and passwordless codes; passkeys and TOTP MFA available (Essentials tier). Owner MFA required in Phase 3.
- Next.js uses `@aws-amplify/adapter-nextjs` for HTTP-only session cookies; every server action/route verifies the access token with `aws-jwt-verify` and maps `sub` → `users.id`.
- Cognito **Post Confirmation** Lambda trigger creates the `users` row (and, in Phase 4, the first organization).
- Facebook Login is used **only to connect Pages**, never to sign in.

### 3.4 Future S10/Suite identity — strategy

Cognito makes the S10/Suite path straightforward:

| Step | When | What |
|---|---|---|
| 1 | Phase 1 | Create a **dedicated Cognito user pool named for S10 Identity** (not for "marketing") in its own CDK stack. S10/Marketing is its first **app client**. App code depends only on `getCurrentUser()` / `getEntitlements(orgId)`. |
| 2 | Phase 1 | `user_identities(user_id, issuer, subject)` table stores the Cognito issuer + `sub`, so a later move to another issuer is a data migration, not a rewrite. |
| 3 | When S10/Mail or others join | Move the pool to an `s10-shared` account (or keep it and add app clients). Each product = one app client with its own callback URLs and scopes; each product keeps its **own** database and org/user tables keyed by `sub`. Single sign-on across S10 products comes from the shared managed-login session. |
| 4 | Same time | Entitlements published by a small S10 billing service (Stripe webhooks → product entitlements); S10/Marketing's `EntitlementsProvider` switches from local to suite. Optional Cognito pre-token-generation trigger adds product-access claims. |

S10 products never share a database. **LimitKeep is never added as an app client.**

---

## 4. Data model

### 4.1 Entity overview

| Group | Tables |
|---|---|
| Identity & tenancy | `users`, `user_identities`, `organizations`, `organization_members`, `invitations` (Phase 4) |
| Brands | `brands`, `brand_voice_profiles` (versioned), `brand_assets` |
| Social | `oauth_states`, `social_connections`, `social_credentials` (KMS ciphertext), `social_targets` (a Facebook Page / IG account) |
| Content | `content_items`, `posts` (status machine), `post_revisions`, `media_assets`, `post_media` |
| Workflow | `approvals`, `publish_jobs`, `publish_attempts`, `published_posts` |
| Sources | `content_sources`, `source_items`, `webhook_events` |
| Automation | `automation_rules`, `automation_runs`, `notifications` |
| AI & metering | `ai_generations`, `usage_events`, `org_entitlements` |
| Ops | `audit_logs`, `system_flags` (kill switches), `job_heartbeats` |
| Billing (Phase 4) | `plans`, `subscriptions` |
| Ads (Phase 5) | `ad_accounts`, `ad_campaign_drafts`, `ad_actions`, `ad_spend_snapshots` |

### 4.2 Post status machine

```
draft ──submit──▶ awaiting_approval ──approve──▶ approved ──schedule──▶ scheduled ──trigger──▶ publishing
  ▲                    │ reject                    │ publish now ─────────────────────────────────▶ │
  └────── edit ◀───────┘                                                                            ▼
                                             published ◀── success ── publishing ── failure ──▶ failed
                                                                       │ ambiguous                │ retry
                                                                       ▼                          ▼
                                                              needs_reconciliation ──────▶ scheduled/publishing
 any non-published state ──cancel──▶ canceled ;  published/failed/canceled ──archive──▶ archived
```

Transitions live only in `src/server/domain/posts/transitions.ts`; a trigger writes `audit_logs` for every status change.

### 4.3 Reference DDL (draft — Claude Code refines in M1.2)

```sql
create schema if not exists app;
create type app.org_role as enum ('owner','admin','editor','viewer');
create type app.post_status as enum ('draft','awaiting_approval','approved','scheduled',
  'publishing','published','failed','needs_reconciliation','canceled','archived');
create type app.platform as enum ('facebook_page','instagram','linkedin','x','threads');

create function app.current_user_id() returns uuid language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create function app.current_actor() returns text language sql stable
  as $$ select coalesce(nullif(current_setting('app.actor', true), ''), 'user') $$;
create function app.current_system_org() returns uuid language sql stable
  as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);
create table public.user_identities (
  user_id uuid not null references public.users(id) on delete cascade,
  issuer text not null,                 -- Cognito user pool issuer URL
  subject text not null,                -- Cognito sub
  primary key (issuer, subject)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text unique not null,
  timezone text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now()
);
create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role app.org_role not null default 'owner',
  primary key (org_id, user_id)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, slug text not null, description text, website_url text,
  timezone text, settings jsonb not null default '{}', archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id), unique (org_id, slug)
);

create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  platform app.platform not null,
  external_user_id text not null,
  display_name text,
  granted_scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','needs_reauth','revoked')),
  connected_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, id), unique (org_id, platform, external_user_id)
);

-- KMS ciphertext; encryption context = {org_id, connection_id}. No SELECT policy for user actors.
create table public.social_credentials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  connection_id uuid not null,
  target_external_id text,              -- null = user token; Page id = Page token
  token_type text not null check (token_type in ('user_long_lived','page','system_user')),
  kms_key_arn text not null,
  ciphertext bytea not null,
  expires_at timestamptz,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, connection_id) references public.social_connections(org_id, id) on delete cascade
);

create table public.social_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, brand_id uuid not null, connection_id uuid not null,
  platform app.platform not null, external_id text not null, name text not null,
  status text not null default 'active' check (status in ('active','needs_reauth','disconnected')),
  daily_post_cap int not null default 10,
  unique (org_id, id), unique (org_id, platform, external_id),
  foreign key (org_id, brand_id) references public.brands(org_id, id) on delete cascade,
  foreign key (org_id, connection_id) references public.social_connections(org_id, id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, brand_id uuid not null,
  content_item_id uuid, target_id uuid,               -- null target = unassigned draft
  status app.post_status not null default 'draft',
  body text not null default '', link_url text,
  scheduled_at timestamptz,                           -- UTC
  schedule_name text,                                 -- EventBridge Scheduler schedule name
  content_hash text generated always as
    (md5(lower(regexp_replace(body, '\s+', ' ', 'g')) || coalesce(link_url, ''))) stored,
  ai_generation_id uuid,
  approved_by uuid references public.users(id), approved_at timestamptz,
  version int not null default 1,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, brand_id) references public.brands(org_id, id) on delete cascade,
  foreign key (org_id, target_id) references public.social_targets(org_id, id)
);

create table public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, post_id uuid not null,
  idempotency_key text not null unique,               -- 'publish:' || post_id || ':v' || version
  run_at timestamptz not null,
  state text not null default 'queued'
    check (state in ('queued','running','succeeded','failed','dead','canceled','reconciling')),
  attempts int not null default 0, max_attempts int not null default 5,
  locked_until timestamptz,
  last_error_code text, last_error_message text,
  created_at timestamptz not null default now(),
  foreign key (org_id, post_id) references public.posts(org_id, id) on delete cascade
);

create table public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, job_id uuid not null references public.publish_jobs(id) on delete cascade,
  started_at timestamptz not null default now(), finished_at timestamptz,
  outcome text check (outcome in ('success','retryable','permanent','ambiguous')),
  http_status int, platform_error_code int, platform_error_subcode int, fbtrace_id text,
  request_fingerprint text, response_excerpt jsonb      -- redacted, never tokens
);

create table public.published_posts (
  post_id uuid primary key, org_id uuid not null,
  platform app.platform not null, external_post_id text not null,
  permalink_url text, published_at timestamptz not null,
  unique (platform, external_post_id)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid, actor_user_id uuid,
  actor_type text not null check (actor_type in ('user','system','automation','webhook')),
  action text not null, entity_type text not null, entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

Remaining tables (`brand_voice_profiles`, `content_items`, `post_revisions`, `media_assets` with `s3_key`, `post_media`, `approvals`, `oauth_states`, `content_sources`, `source_items`, `webhook_events`, `automation_rules`, `automation_runs`, `ai_generations`, `usage_events`, `org_entitlements`, `notifications`, `system_flags`, `job_heartbeats`) follow the same pattern; columns are listed in 05 §4.

### 4.4 RLS pattern

```sql
create function app.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (app.current_actor() = 'system' and app.current_system_org() = p_org)
      or exists (select 1 from public.organization_members m
                 where m.org_id = p_org and m.user_id = app.current_user_id());
$$;

alter table public.posts enable row level security;
alter table public.posts force row level security;
create policy posts_rw on public.posts for all to app_rw
  using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

alter table public.social_credentials enable row level security;
alter table public.social_credentials force row level security;
create policy creds_system_only on public.social_credentials for all to app_rw
  using (app.current_actor() = 'system' and app.current_system_org() = org_id)
  with check (app.current_actor() = 'system' and app.current_system_org() = org_id);
```

Roles: `app_owner` (owns schema, used only by migrations), `app_rw` (application and workers, RLS enforced, `force row level security` on every table). Data API uses a Secrets Manager secret for `app_rw`; migrations use a separate secret for `app_owner`. Tests prove: org A can't see org B; viewers can't write; user actors can never read `social_credentials`.

---

## 5. AI provider abstraction (Bedrock)

```
ContentStudioService.generate(brandId, request)
  ├─ BrandContextBuilder → voice profile, recent posts (anti-repetition), CTA defaults
  ├─ PromptTemplate (versioned, in code)
  ├─ AiGateway.generateObject(task, zodSchema, input)          ← provider-agnostic
  │     └─ ModelRouter: task → model id (SSM Parameter Store), fallback chain
  │           ├─ BedrockConverseProvider  (default; Claude via us.* inference profiles, Nova, others)
  │           └─ AnthropicDirectProvider  (optional fallback, API key in Secrets Manager)
  ├─ OutputValidator (schema, Facebook length limits, banned phrases, link present)
  └─ UsageMeter (tokens, estimated cost) + budget check before each call
```

- **Bedrock Converse API** is the abstraction: switching between Claude, Amazon Nova or another Bedrock model is a model-ID change in Parameter Store.
- Defaults: **`us.anthropic.claude-sonnet-5-5`** (cross-Region inference profile, callable from us-east-1) for generation; the Haiku 5.5 equivalent for rewrites/summaries (confirm its profile ID in the Bedrock console).
- Structured output and explicit prompt caching (brand-context block) are supported for Sonnet 5.5 on `bedrock-runtime`. The Bedrock model card lists **Batch as not supported** for Sonnet 5.5 — don't plan on batch discounts there.
- **Stream** generation to the Studio (Vercel supports streaming) so drafts appear as they are written; validate the structured result once the stream completes. Long calls need a Vercel function `maxDuration` that covers them.
- Guardrails: external text in delimited data blocks; the model has no action tools; per-org budgets and per-day caps enforced before calls; optional **Bedrock Guardrails** for content filters; CloudWatch alarm on Bedrock spend.
- Image generation (Phase 5): Bedrock image model (Amazon Nova Canvas or a newer equivalent) behind an `ImageGenerator` interface.

---

## 6. Background jobs and scheduling (EventBridge + SQS + Lambda)

### 6.1 Flow

```
Approve + schedule (web) ── tx: posts.status='scheduled', insert publish_jobs(run_at, idempotency_key)
                         └─ after commit: scheduler.CreateSchedule(
                               Name = 'post-<postId>-v<version>',
                               ScheduleExpression = 'at(2026-11-03T09:00:00)', ScheduleExpressionTimezone = brand tz,
                               FlexibleTimeWindow = OFF, ActionAfterCompletion = DELETE,
                               Target = SQS publish-queue, Input = {"jobId": "...", "idempotencyKey": "..."},
                               RetryPolicy + DeadLetterConfig = scheduler-dlq)
Publish now (web)        ── same tx, then sqs.SendMessage(publish-queue) immediately
Reschedule / cancel      ── tx updates job/post (version++), then DeleteSchedule(old) [+ CreateSchedule(new)]
publish-worker (Lambda, SQS trigger, batch size 1, reserved concurrency 5):
   1. UPDATE publish_jobs SET state='running', attempts=attempts+1, locked_until=now()+'5 min'
        WHERE id=:jobId AND state IN ('queued','reconciling') OR (state='running' AND locked_until < now())
        RETURNING ...          -- zero rows → stale/duplicate message → ack and exit
   2. re-check post (approved, not canceled, version matches, kill switch off, target active)
   3. insert publish_attempts (before the HTTP call), call Meta, classify, update states, audit
   4. retryable → set state='queued', run_at=now()+backoff, CreateSchedule(at backoff) ; message acked
sweeper (Lambda, every 15 min): re-enqueue queued jobs whose run_at < now()-5 min (missed triggers),
   release expired locks, run reconciliation, daily token validation, heartbeat metric
```

The database decides whether work happens; schedules and messages are just triggers. Duplicate SQS deliveries, a schedule that fires after a cancel, or a sweeper re-enqueue are harmless because step 1 is an atomic state check.

### 6.2 Why this design

- **No polling every minute** → Aurora can pause when nobody is using the app (cost) and there's no always-on dispatcher.
- EventBridge Scheduler handles time zones/DST natively and supports far-future dates (unlike Meta's 10-minute-to-30-day native scheduling window).
- The sweeper is the safety net if a schedule or message is lost.
- Swapping to Step Functions (e.g. multi-step video publishing with waits) is possible later without changing domain code.

### 6.3 Idempotency, duplicates, errors

Unchanged from revision 1 and still essential because the Graph API has no idempotency keys:
- unique `idempotency_key` per `(post, version)`;
- attempt row written **before** the HTTP call;
- outcome classes: **success** (store external id) · **retryable** (rate-limit codes 4/17/32/613/80001, 5xx, codes 1/2; back off using `X-Business-Use-Case-Usage.estimated_time_to_regain_access`) · **permanent** (190 → connection `needs_reauth`; permission/parameter/policy errors) · **ambiguous** (timeout after send → `reconciling`; the reconciler reads `GET /{page-id}/feed` around the attempt time and matches normalized message+link before any retry);
- per-target duplicate guard on `content_hash` (default 7 days);
- per-target daily caps and Meta-specific caps (e.g. 30 API-published Reels/Page/24 h).

### 6.4 Other recurring jobs

| Schedule | Lambda | Work |
|---|---|---|
| rate(15 min) | sweeper | missed jobs, locks, reconciliation, heartbeat |
| rate(30 min) | feed-poller | enqueue due sources → ingest-queue → ingest Lambda |
| cron(0 9 * * ? *) per org tz (or daily UTC) | digest | approval/failure digest emails via SES |
| rate(1 day) | token-check | `debug_token` per credential → `needs_reauth` + notification |
| rate(1 day) | retention | delete expired attempts, raw source content, old notifications |

---

## 7. Social platform integration

### 7.1 Adapter interface

```ts
interface SocialPlatformAdapter {
  platform: Platform;
  capabilities: { text: boolean; link: boolean; image: boolean; multiImage: boolean; video: boolean; reel: boolean;
                  maxTextLength: number };
  buildAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<ConnectionGrant>;
  listTargets(grant: ConnectionGrant): Promise<TargetCandidate[]>;
  validatePost(post: PostDraft, target: Target): ValidationResult;
  publish(post: PostDraft, target: Target, token: Secret): Promise<PublishResult>;
  findRecentPost(match: ReconcileQuery, target: Target, token: Secret): Promise<ExternalPost | null>;
  classifyError(err: unknown): 'retryable' | 'permanent' | 'auth' | 'rate_limited' | 'ambiguous';
}
```

### 7.2 Facebook Page connection (Facebook Login for Business)

1. `GET /api/oauth/meta/start` → insert `oauth_states` (single-use, 10-min expiry, bound to user) → redirect with `config_id`.
2. `GET /api/oauth/meta/callback` → validate state → exchange code server-side (app secret from **Secrets Manager**) → long-lived user token (~60 days) → `GET /me/accounts?fields=id,name,access_token,tasks` → keep Pages whose tasks include `CREATE_CONTENT`.
3. Encrypt each token with **KMS `Encrypt`** (context `{org_id, connection_id}`) and store ciphertext. Plaintext exists only in memory during the callback.
4. User maps Pages → brands (`social_targets`).
5. Disconnect: delete credentials, mark targets disconnected, optionally revoke the grant, audit.
6. Deauthorize and data-deletion callbacks verify Meta's `signed_request` (HMAC-SHA256 with the app secret).
7. All server-side Graph calls include `appsecret_proof`. Pin `v26.0`.

Phase 4 option: Business Integration System User tokens (see 03 §4).

### 7.3 Media

S3 bucket `s10-marketing-media-<env>` (private, SSE-KMS or SSE-S3, versioning, lifecycle for deleted objects). Keys `org/<org_id>/brand/<brand_id>/<uuid>.<ext>`; the server issues presigned PUT URLs only after an authorization check. S3 event → media-processor Lambda (sharp layer) validates type/size/dimensions, strips EXIF, writes metadata. Meta photo posts use a presigned GET URL valid 5–15 minutes; video uses Meta's resumable upload.

---

## 8. Website and CMS integration

| Source | Mechanism |
|---|---|
| RSS/Atom (default) | feed-poller Lambda with conditional GET (`ETag`, `If-Modified-Since`), dedupe by GUID → canonical URL |
| Signed webhook (SPEN10 custom) | `POST /api/webhooks/sources/{id}` with HMAC-SHA256 over timestamp + raw body; replay protection via `webhook_events`; per-source secret stored KMS-encrypted |
| WordPress REST | `GET /wp-json/wp/v2/posts?after=…` |
| Sitemap | `lastmod` diff fallback |

Pipeline: detect → `source_items` → normalize (title, URL, summary, OG image; HTML→text; 20k-char cap) → automation rule → drafts in `awaiting_approval` → SES notification.
Fetch safety: http(s) only, DNS-resolve and block private/loopback/link-local ranges, ≤3 redirects re-checked, 10 s timeout, 2 MB cap, `robots.txt` respected for non-owned sites. (Lambdas run outside a VPC, so they cannot reach internal AWS networks — a useful extra SSRF barrier.)

---

## 9. Frontend and UX

Unchanged from revision 1: app shell with brand switcher (`/b/[brandSlug]/…`), dashboard, Studio (variants → edit → transform → target → approve/schedule/publish), calendar (month/week/list, drag reschedule), queue/history with plain-language errors and fix actions, onboarding checklist, dark-mode-first S10 design tokens, product name in one constant, mobile-friendly approvals. Streaming RSC and streamed AI output are available on Vercel; use Suspense for slow (Aurora-resuming) data.

---

## 10. Billing and subscriptions (Phase 4)

Stripe (separate S10 account) → `POST /api/webhooks/stripe` → `webhook_events` idempotency → `subscriptions` + `org_entitlements`. Feature code reads only `org_entitlements` through `EntitlementsProvider`. Usage metered from `usage_events`; hard limits on AI generation, never silently dropping approved scheduled posts. (AWS Marketplace SaaS listing is a possible later sales channel, not a replacement for Stripe.)

---

## 11. Security summary

| Control | Implementation |
|---|---|
| Tenant isolation | RLS (`force row level security`) + composite FKs + service checks + tests |
| Secrets | Secrets Manager / Parameter Store; IAM compute role; no access keys anywhere |
| Token encryption | KMS CMK, encryption context per tenant, Encrypt/Decrypt split across IAM roles, key rotation enabled |
| OAuth | state single-use + expiry + user binding; server-side code exchange; `appsecret_proof` |
| Webhooks | HMAC + timestamp + replay table |
| AI | untrusted-content delimiting; no action tools; budgets; optional Bedrock Guardrails |
| Abuse/rate limits | per-org caps in Postgres; WAF rate-based rules in Phase 4; Cognito advanced security (Plus) optional |
| Logging | JSON logs with redaction of tokens/secrets; CloudWatch log retention 30–90 days |
| Audit | `audit_logs` for every publishing, connection, automation and (later) ads action; CloudTrail for AWS API activity |
| Least privilege | one IAM role per Lambda; web role scoped to exact resources |
| Data deletion | org soft-delete → 30-day grace → hard delete of rows and S3 objects; revoke Meta grants |

---

## 12. Deployment, monitoring, backups

- **CDK stacks** (`infra/`): `NetworklessCoreStack` (KMS key, S3 bucket, SQS queues/DLQs, SNS topic), `DatabaseStack` (Aurora Serverless v2, min 0 / max 4 ACU initially, Data API enabled, secrets), `IdentityStack` (Cognito pool "s10-identity", app client, managed-login domain, triggers), `WorkersStack` (Lambdas, Scheduler role, recurring schedules), `VercelAccessStack` (Vercel OIDC provider + web runtime role), `ObservabilityStack` (alarms, dashboard, budgets).
- **CI/CD:** Vercel builds and deploys the Next.js app on push (`main` → production; every other branch and PR → preview, which uses the dev AWS account). GitHub Actions (OIDC to an IAM deploy role; no stored AWS keys) runs typecheck/lint/tests, `cdk diff`, and — only with owner approval via a protected GitHub environment — `cdk deploy` and database migrations.
- **Migrations:** SQL files applied through the **Data API** by the migration runner (Drizzle migrator using the `app_owner` secret) — no direct network path to the database is needed.
- **Monitoring:** CloudWatch alarms → SNS (email + SMS): publish-queue DLQ > 0, scheduler DLQ > 0, worker error rate, Lambda throttles, "no heartbeat in 30 min" (missing data = breaching), overdue jobs found by sweeper, Aurora resume failures, Bedrock spend, AWS Budgets thresholds. A CloudWatch dashboard shows publishes, failures, AI tokens.
- **Backups:** Aurora automated backups with point-in-time restore, 14-day retention; AWS Backup plan for monthly snapshots kept 1 year (and cross-Region copy later); S3 versioning + lifecycle; quarterly restore drill into the dev account.
- **Runbooks:** token invalidated, Meta outage, DLQ messages, stuck jobs, Aurora restore, KMS key issues, kill switch.

---

## 13. Data retention

| Data | Retention |
|---|---|
| Posts & published history | life of the org (until deleted) |
| Publish attempts (redacted) | 180 days |
| AI generation metadata | 13 months |
| Raw source content | 90 days |
| Audit logs | 2 years |
| CloudWatch logs | 30 days (prod app logs), 90 days (audit-relevant Lambda logs) |
| Tokens | deleted on disconnect/deauthorize/org deletion |
| Org deletion | 30-day grace, then hard delete + S3 purge + Meta revoke |

---

## 14. Trade-offs and cost traps to avoid

| Topic | Note |
|---|---|
| Hosting | Vercel (ADR 0012) gives current Next.js/React and streaming. Exit path if needed: Amplify Hosting or OpenNext on Lambda + CloudFront; the AWS side doesn't change. |
| Aurora cold start | After auto-pause, the first request waits ~15 s (30 s+ after >24 h). Fine for an internal tool; for paying customers set **min capacity 0.5 ACU** (≈ $44/mo at $0.12/ACU-h) or a business-hours schedule. |
| Data API limits | 1 MiB response limit; writer-only; not on T instance classes (irrelevant for Serverless v2). Paginate list queries. |
| NAT Gateway | Avoided by design (no VPC Lambdas). Don't add one casually — it is one of the most common surprise AWS bills. |
| RDS Proxy | Not needed with Data API, and it would keep Aurora from pausing. |
| CloudWatch logs | Default retention is "never expire" — set retention in CDK for every log group. |
| Edge protection | Vercel Firewall rules at public launch; Vercel usage beyond Pro allowances is billed per use — set a Vercel spend limit. |

---

## 15. Key architecture decisions (ADR summary)

| ADR | Decision |
|---|---|
| 0001 | Separate repo and separate AWS accounts (dev/prod) for S10/Marketing |
| 0002 | Multi-tenant (org → brand) with Postgres RLS from the first migration |
| 0003 | Own scheduler: EventBridge Scheduler per-post triggers + SQS + Lambda, DB as source of truth; Meta native scheduling not primary |
| 0004 | Social tokens encrypted with KMS (tenant encryption context, Encrypt/Decrypt role split) |
| 0005 | Facebook Login for Business for connecting Pages only |
| 0006 | AI via Bedrock Converse behind a task-based `AiGateway`; Claude default |
| 0007 | Cognito "S10 Identity" pool from day one; products federate as app clients; LimitKeep excluded |
| 0008 | Human approval default; auto-publish only through capped policies |
| 0009 | **AWS-first**: Aurora Serverless v2 + Data API, Cognito, SES, S3, KMS, Secrets Manager, CloudWatch; non-AWS only for GitHub, Stripe, Meta |
| 0010 | No VPC networking for app components (Data API + IAM over HTTPS) |
| 0011 | cdk-nag v3 via CDK Validations + synth-time cost guardrails |
| 0012 | **Web hosting on Vercel** (Next.js 16, React 19.3, streaming) with OIDC → IAM role; supersedes the Amplify part of 0009 |
