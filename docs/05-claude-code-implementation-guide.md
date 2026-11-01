# 05 — Claude Code Implementation Guide (AWS-first)

The operating manual for building S10/Marketing with Claude Code, one milestone at a time. Read with `CLAUDE.md`, `02-technical-architecture.md` and `04-roadmap.md`.

---

## 1. How to run a milestone

### 1.1 Kickoff prompt (paste into Claude Code, PowerShell)

```
We are starting milestone <M#.#> of S10/Marketing.
1. Read CLAUDE.md, docs/04-roadmap.md (section <M#.#>), docs/02-technical-architecture.md (relevant sections),
   and docs/05-claude-code-implementation-guide.md.
2. Inspect the current code, CDK stacks and migrations before changing anything. Summarize what exists and what's missing.
3. Propose a short plan (files, migrations, CDK changes, tests) and list decisions that need my approval.
   Wait for my OK before writing code if any ⛔ stop condition applies.
4. Implement only this milestone. Run: pnpm typecheck, pnpm lint, pnpm test, pnpm test:db, pnpm infra:synth
   (and pnpm test:e2e if UI changed). For CDK changes, show me `cdk diff` output — do not deploy.
5. Update docs/CHANGELOG.md and ADRs. Summarize what changed, how to verify manually, open questions.
Do not deploy, run migrations against AWS, or change any other project without my explicit approval.
```

### 1.2 Milestone loop

1. **Inspect** — `git status`, read touched modules/stacks, list migrations, run tests for a baseline.
2. **Plan** — post the plan; flag stop conditions.
3. **Implement in small commits** — migration → domain/service → infra (CDK) → API/server actions → UI → tests.
4. **Verify** — all checks green, `cdk synth` succeeds, `cdk diff` reviewed; manual verification steps written down.
5. **Document** — CHANGELOG, ADRs, `.env.example` (names only), Parameter Store/Secrets inventory, runbooks.
6. **Stop** — don't start the next milestone without the owner's go-ahead.

### 1.3 ⛔ Stop and ask the owner before

- `cdk deploy`, `cdk destroy`, or any AWS console/CLI change (any account), DNS changes, Meta app settings, Stripe changes;
- running migrations against the dev or prod Aurora cluster;
- merging to `main` (triggers the Vercel production deploy); creating or changing the Vercel project, team, domains or environment variables;
- anything that adds recurring cost (new paid service, min ACU > 0, WAF, Multi-AZ readers, dedicated IPs, NAT gateways, RDS Proxy);
- requesting new Meta permissions or changing the Facebook Login configuration;
- enabling a new Bedrock model or raising Bedrock quotas;
- publishing to a real social account outside a test the owner initiated;
- creating/launching ads or changing budgets (always);
- modifying another repository (SPEN10, S10/Mail, LimitKeep);
- weakening a security control (RLS, IAM scope, KMS policy, auth checks, redaction) or a test guarding one;
- making a product decision the docs don't specify.

### 1.4 AWS credentials for Claude Code

- Owner sets up **IAM Identity Center** with a `Developer` permission set for `s10-marketing-dev` (read/write limited to the project's resources) and a `ReadOnly` set for prod.
- In PowerShell: `aws sso login --profile s10-dev`; Claude Code uses `$env:AWS_PROFILE = "s10-dev"`. **Never** create IAM user access keys or paste credentials into files.
- Prod deployments run only from GitHub Actions (OIDC role) after owner approval in a protected environment.

---

## 2. Repository conventions

| Topic | Convention |
|---|---|
| Package manager | pnpm workspaces (`apps/web`, `infra`, `packages/*`) |
| Language | TypeScript `strict`, `noUncheckedIndexedAccess` |
| Next.js | **16.x** + React 19.3 on Vercel; streaming allowed; Node.js runtime for routes that call AWS (no edge runtime there) |
| Node | Current LTS supported by both Lambda and Vercel (24); pin in `.nvmrc` and CDK `Runtime` |
| Lambda | Node.js on **arm64**, bundled with `NodejsFunction` (esbuild); one IAM role per function |
| Imports | `@/` → `apps/web/src`; shared domain code in `packages/core` (used by web and Lambdas) |
| Server vs client | Domain logic only in `packages/core` / `apps/web/src/server/**` (`import 'server-only'`) |
| DB access | Drizzle query builder; **every query runs inside `withDbContext({ userId } or { systemOrgId }, fn)`**, which opens a Data API transaction and calls `set_config` first. Raw SQL allowed for migrations and RLS-sensitive functions |
| Validation | zod for all inputs, config, AI output |
| Config | Non-secrets in SSM Parameter Store (`/s10-marketing/<env>/...`), secrets in Secrets Manager; loaded once per cold start and cached |
| Errors | Typed `AppError(code)`; never leak upstream payloads |
| Logging | JSON to stdout (→ CloudWatch) with redaction paths: `*.access_token`, `*.token`, `authorization`, `*.secret`, `*.ciphertext`, `*.code` |
| Time | UTC `timestamptz`; IANA zone at the edges; Scheduler gets the brand zone |
| Money | micro-USD integers for AI cost; cents for billing |
| Commits | Conventional Commits; branch per milestone (`m1.4-facebook-connect`); PR into `develop`, release PR `develop → main` |
| Windows | Cross-platform Node scripts via `pnpm`; avoid bash-only syntax; PowerShell 5 users: separate commands with `;` |

---

## 3. Directory structure

```
s10-marketing/
├─ CLAUDE.md  README.md  .env.example  pnpm-workspace.yaml
├─ docs/  (01–06, adr/, discovery/, spikes/, runbooks/, security/, CHANGELOG.md)
├─ scripts/
│  ├─ discovery/Get-ProjectInventory.ps1
│  ├─ db-migrate.ts            applies SQL migrations via Data API (app_owner secret) or local pg
│  ├─ seed.ts                  internal orgs/brands (local/dev only)
│  └─ eval-ai.ts               manual AI evals (costs money)
├─ db/
│  ├─ migrations/              0001_core_tenancy.sql …
│  └─ tests/                   rls_*.test.ts (Vitest against local Postgres as app_rw)
├─ packages/
│  └─ core/src/
│     ├─ db/                   client.ts (data-api | pg), context.ts (withDbContext), schema.ts (Drizzle)
│     ├─ domain/               orgs/ brands/ content/ posts/ sources/ automations/ usage/
│     ├─ ai/                   gateway.ts router.ts meter.ts providers/{bedrock-converse,anthropic}.ts prompts/ schemas/
│     ├─ publishing/           publish-service.ts reconciler.ts duplicate-guard.ts
│     ├─ integrations/meta/    client.ts auth.ts pages.ts adapter.ts errors.ts signed-request.ts
│     ├─ integrations/platform.ts
│     ├─ sources/              rss.ts wordpress.ts webhook.ts safe-fetch.ts normalize.ts
│     ├─ scheduling/           scheduler.ts (EventBridge Scheduler), queue.ts (SQS)
│     ├─ security/             kms-vault.ts hmac.ts redact.ts rate-limit.ts
│     ├─ notify/               ses-notifier.ts templates/
│     ├─ billing/              entitlements.ts
│     └─ config/               params.ts (SSM/Secrets loader + zod)
├─ apps/
│  ├─ web/                     Next.js 16 (vercel.json)
│  │  └─ src/
│  │     ├─ app/(auth)/  (app)/dashboard  (app)/b/[brandSlug]/{studio,calendar,queue,history,sources,automations,media,settings}
│  │     ├─ app/api/oauth/meta/{start,callback}/route.ts
│  │     ├─ app/api/meta/{deauthorize,data-deletion}/route.ts
│  │     ├─ app/api/webhooks/sources/[sourceId]/route.ts   app/api/webhooks/stripe/route.ts (Phase 4)
│  │     ├─ app/api/health/route.ts
│  │     ├─ server/auth/       session.ts (Amplify auth adapter + aws-jwt-verify), permissions.ts
│  │     └─ components/        ui/ app-shell/ calendar/ post-editor/ status-chip/
│  └─ workers/                 Lambda handlers (thin; call packages/core)
│     └─ src/{publish-worker,sweeper,feed-poller,ingest,media-processor,notifier,token-check,retention,cognito-post-confirmation}.ts
├─ infra/                      AWS CDK app
│  ├─ bin/app.ts
│  └─ lib/{core,database,identity,workers,hosting,observability}-stack.ts
├─ tests/  (unit/ integration/ e2e/ fixtures/meta/*.json)
└─ .github/workflows/{ci.yml,deploy-infra.yml,migrate.yml}
```

---

## 4. Database migrations

Plain SQL in `db/migrations`, forward-only, numbered, applied by `scripts/db-migrate.ts` (tracks applied files in `app.schema_migrations`; runs each file in one transaction). Locally against Docker Postgres 16; in AWS through the Data API with the `app_owner` secret. Drizzle `schema.ts` is kept in sync (or generated with `drizzle-kit pull`) for typed queries.

| # | Migration | Contents |
|---|---|---|
| 0001 | `core_tenancy` | roles `app_owner`/`app_rw`, `app` schema, enums, context functions, `users`, `user_identities`, `organizations`, `organization_members`, `brands`, `brand_voice_profiles(id, org_id, brand_id, version, audience, tone, guidelines, do_list, dont_list, example_posts, cta_defaults, is_active)`, `audit_logs`, `system_flags`, `app.is_org_member`, `app.has_org_role`, audit trigger, RLS + `force row level security` |
| 0002 | `content_ai` | `content_items(id, org_id, brand_id, kind, title, brief, source_item_id, created_by)`, `posts`, `post_revisions`, `ai_generations(id, org_id, brand_id, task, template_id, template_version, provider, model_id, input_tokens, output_tokens, cache_read_tokens, cost_micros, latency_ms, status, error_code, created_by)`, `usage_events(org_id, kind, quantity, cost_micros, ref_id, occurred_at)`, `org_entitlements` |
| 0003 | `social` | `oauth_states(state, org_id, brand_id, user_id, platform, redirect_to, expires_at, used_at)`, `social_connections`, `social_credentials` (KMS ciphertext; system-only policy), `social_targets` |
| 0004 | `publishing` | `publish_jobs`, `publish_attempts`, `published_posts`, `approvals(post_id, decision, decided_by, note)`, status trigger → audit |
| 0005 | `media` | `media_assets(id, org_id, brand_id, s3_key, mime, bytes, width, height, duration_ms, alt_text, sha256, status, created_by)`, `post_media(post_id, media_id, position)` |
| 0006 | `jobs_ops` | `job_heartbeats`, indexes for sweeper (`publish_jobs(state, run_at)`), kill-switch flags |
| 0007 | `sources` | `content_sources(id, org_id, brand_id, type, url, webhook_secret_ciphertext, poll_interval_min, etag, last_modified, last_polled_at, status)`, `source_items(…, unique(source_id, guid))`, `webhook_events(provider, event_id unique, received_at, processed_at)` |
| 0008 | `automation` | `automation_rules(id, org_id, brand_id, name, trigger, action, policy, caps, enabled)`, `automation_runs`, `notifications` |
| 0009 | `retention` | retention SQL functions (invoked by the retention Lambda) |
| 0010+ | Phase 4 | `invitations`, `plans`, `subscriptions`, deletion requests |

Rules: every tenant table has `org_id`, `unique(org_id,id)`, composite FKs, RLS forced, and an isolation test; expand/contract for breaking changes; never edit an applied migration.

---

## 5. Configuration and secrets

`.env.example` covers **local development only**. In AWS, config comes from Parameter Store and Secrets Manager via IAM.

| Name | Where (AWS) | Purpose |
|---|---|---|
| `APP_ENV` | Vercel env var / Lambda env | `local` / `dev` / `prod` |
| `AWS_ROLE_ARN` | Vercel env var (per Vercel environment) | Web runtime role assumed via Vercel OIDC (not a secret) |
| `APP_URL` | Parameter Store `/s10-marketing/<env>/app-url` | Redirects, links |
| `AWS_REGION` | runtime | `us-east-1` |
| `DB_CLUSTER_ARN`, `DB_SECRET_ARN`, `DB_NAME` | Parameter Store (ARNs are not secrets) | Data API target; secret holds `app_rw` credentials |
| `DB_OWNER_SECRET_ARN` | CI only | Migrations |
| `DATABASE_URL` | local `.env.local` only | Docker Postgres |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN` | Parameter Store / Vercel env (public IDs only) | Auth |
| `META_APP_ID`, `META_LOGIN_CONFIG_ID`, `META_GRAPH_VERSION` (`v26.0`), `META_REDIRECT_URI` | Parameter Store | Meta |
| `META_APP_SECRET` | **Secrets Manager** `s10-marketing/<env>/meta-app-secret` | Code exchange, `appsecret_proof`, signed_request |
| `TOKEN_KMS_KEY_ARN` | Parameter Store | KMS key for social tokens |
| `PUBLISH_QUEUE_URL`, `INGEST_QUEUE_URL` | Parameter Store | SQS |
| `SCHEDULER_GROUP`, `SCHEDULER_TARGET_ROLE_ARN` | Parameter Store | EventBridge Scheduler |
| `MEDIA_BUCKET` | Parameter Store | S3 |
| `AI_MODEL_GENERATE`, `AI_MODEL_FAST` | Parameter Store | Claude Sonnet 5.5 / Claude Haiku 5.5 inference profiles (e.g. `us.anthropic.claude-sonnet-5-5`); confirm both IDs in the Bedrock console |
| `AI_DEFAULT_MONTHLY_BUDGET_USD` | Parameter Store | Default org AI budget |
| `ANTHROPIC_API_KEY` | Secrets Manager (optional) | Direct-API fallback only |
| `SES_FROM_ADDRESS`, `SES_CONFIGURATION_SET` | Parameter Store | Notifications |
| `OPS_ALERT_TOPIC_ARN` | Parameter Store | SNS |
| `PUBLISHING_ENABLED`, `AUTOMATION_ENABLED` | Parameter Store + `system_flags` | Kill switches (dev: publishing off) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Secrets Manager (Phase 4) | Billing |

`packages/core/src/config/params.ts` loads and zod-validates everything at cold start; the browser bundle only receives explicitly public values (Cognito client ID/domain, app URL).

---

## 6. API contracts

UI mutations use **Server Actions** (zod-validated, typed). Route Handlers serve OAuth, webhooks and health. Responses: `{ ok: true, data } | { ok: false, error: { code, message } }`.

### 6.1 Server actions

| Action | Input | Output | Authz |
|---|---|---|---|
| `createBrand` | `{ orgId, name, description?, websiteUrl?, timezone? }` | `Brand` | admin+ |
| `updateBrandVoice` | `{ brandId, audience, tone, guidelines, doList[], dontList[], examplePosts[], ctaDefaults }` | `BrandVoiceProfile` | editor+ |
| `generateVariants` | `{ brandId, kind, brief?, sourceItemId?, targetIds[], count (1–5) }` | `{ generationId, variants: [{ text, hook, cta, hashtags[], angle }] }` | editor+, budget |
| `transformText` | `{ brandId, text, op, tone?, platform? }` where `op` ∈ shorten · expand · tone · adapt | `{ text }` | editor+ |
| `savePostDraft` | `{ brandId, contentItemId?, targetId?, body, linkUrl?, mediaIds[], expectedVersion? }` | `Post` | editor+ |
| `submitForApproval` / `approvePost` / `rejectPost` | `{ postId, note? }` | `Post` | editor+ / approver |
| `schedulePost` | `{ postId, scheduledAtLocal: 'YYYY-MM-DDTHH:mm', timezone }` | `Post` (+ job + schedule) | editor+, approved |
| `publishNow` | `{ postId }` | `{ status }` (worker completes async; UI polls) | approver |
| `cancelPost` / `duplicatePost` / `archivePost` / `retryPost` | `{ postId }` | `Post` | editor+ |
| `createUploadUrl` | `{ brandId, fileName, mime, bytes }` | `{ mediaId, url, fields, expiresAt }` (presigned POST) | editor+ |
| `disconnectTarget` | `{ targetId, revokeGrant }` | `{}` | admin+ |
| `createSource` / `testSource` | `{ brandId, type, url }` | `Source` / `{ items }` | admin+ |
| `upsertAutomationRule` | `{ brandId, trigger, action, policy, caps, enabled, confirmAutoPublish? }` | `Rule` | admin+ |

### 6.2 Route handlers

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/oauth/meta/start?brandId=` | session | — | 302 to Meta (`client_id`, `redirect_uri`, `config_id`, `state`, `response_type=code`) |
| `GET /api/oauth/meta/callback?code&state` | session + state | — | 302 to connections page |
| `POST /api/meta/deauthorize` | Meta `signed_request` | form | `200 {}` |
| `POST /api/meta/data-deletion` | Meta `signed_request` | form | `200 { url, confirmation_code }` |
| `GET /api/meta/data-deletion/status?code=` | public | — | status page |
| `POST /api/webhooks/sources/{sourceId}` | `X-S10-Signature: t=…,v1=hex(hmac_sha256(secret, t + '.' + rawBody))` | `{ event: 'article.published', id, url, title?, summary?, publishedAt? }` | `202`; `401` bad signature; `409` replay |
| `GET /api/health` | public | — | `{ ok, version }` (does **not** touch the DB, so it doesn't wake Aurora) |

### 6.3 Messages and schedules

| Channel | Payload |
|---|---|
| SQS `publish-queue` | `{ "jobId": uuid, "idempotencyKey": string, "reason": "scheduled" \| "now" \| "retry" \| "sweeper" }` |
| SQS `ingest-queue` | `{ "sourceId": uuid, "trigger": "poll" \| "webhook", "webhookEventId"?: uuid }` |
| Scheduler name | `post-<postId>-v<version>` in group `s10-marketing-<env>-posts`; `ActionAfterCompletion=DELETE` |

### 6.4 Internal interfaces

`SocialPlatformAdapter`, `AiGateway`/`AiProvider`, `Scheduler` (create/delete one-time schedules), `Queue`, `Notifier`, `EntitlementsProvider`, `CredentialVault` (KMS-backed `put`, `getPageToken`, `revoke`).

---

## 7. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | state machine, error classification, prompt assembly, tz conversion, HMAC, SSRF guard, schedule naming |
| Integration | Vitest + Docker Postgres 16 (`docker compose up db`) | services with RLS on as `app_rw`; job claim concurrency; migrations apply cleanly |
| RLS | Vitest (`db/tests/rls_*.test.ts`) | isolation per table, role matrix, `social_credentials` unreadable to user actors |
| AWS clients | `aws-sdk-client-mock` | KMS, SQS, Scheduler, S3, SES, Bedrock calls and IAM-failure handling |
| Meta | msw fixtures | success, 190, 4/17/32/613/80001, 100, timeout, duplicate |
| Infra | CDK assertions (`aws-cdk-lib/assertions`) + `cdk-nag` | IAM least privilege (no `*` actions on data), encryption on, log retention set, no NAT/RDS Proxy |
| E2E | Playwright against a Vercel preview deployment with publishing disabled + mocked Meta | sign-in → brand → generate → approve → schedule → calendar |
| AI quality | `pnpm eval:ai` (manual, uses dev Bedrock) | brand voice, length, repetition, no invented article facts |

No test calls real Meta or Bedrock in CI; no real tokens in fixtures; every bug fix adds a regression test.

---

## 8. Deployment steps

**One-time (owner-approved, M1.1):**
1. AWS Organizations: create `s10-marketing-dev` and `s10-marketing-prod` accounts; enable IAM Identity Center; create permission sets; enable billing alerts, AWS Budgets ($25 / $75 / $150) and Cost Anomaly Detection.
2. `cdk bootstrap` both accounts in `us-east-1`.
3. GitHub: repo, branch protection on `main` and `develop`, push protection for secrets; IAM OIDC provider + deploy roles per account; protected GitHub environment `prod` requiring owner approval.
4. Bedrock: enable access to the Claude models (and later an image model) in each account.
5. SES (us-east-1): verify the notification subdomain (e.g. `notify.spen10.com`, DKIM + custom MAIL FROM) in the prod account; request production access (leave the sandbox). Dev account stays in the sandbox and only emails verified addresses.
6. Meta: set redirect URI, deauthorize and data-deletion URLs to the Vercel custom domain.
7. Put `META_APP_SECRET` in Secrets Manager manually (never via CDK code or Git).
8. Vercel: Pro team, project `s10-marketing` (root directory `apps/web`), OIDC issuer mode **Team**, env vars `APP_ENV` and `AWS_ROLE_ARN` per environment (see `docs/runbooks/m1.1-first-deploy.md`).

**Per milestone:**
1. PR → CI (typecheck, lint, unit, integration, RLS, CDK synth + assertions + cdk-nag, `cdk diff` comment).
2. Merge to `develop` → Vercel preview deploy against the dev account; owner approves `deploy-infra` (dev) and `migrate` (dev) workflows when needed.
3. Owner verifies on dev.
4. Release PR to `main` → owner approves `deploy-infra` (prod) and `migrate` (prod) **before** the Vercel production deploy if code depends on them (expand/contract).
5. Post-deploy: `/api/health`, sweeper heartbeat metric, one AI generation, CloudWatch alarms in OK state.

**Rollback:** Vercel "Instant Rollback" to the previous production deployment; CDK roll forward (or revert commit + deploy); DB corrective migration or Aurora PITR in the worst case; kill switches.

---

## 9. Milestone definitions of done

| Milestone | Done when |
|---|---|
| M0.1 | Inventory filled, AWS account state documented, no secrets in repo |
| M0.2 | Test post published & publicly visible; findings documented |
| M1.1 | Monorepo + CDK skeleton synth clean; dev account deployed (approved); Vercel preview live with OIDC access to AWS; CI green |
| M1.2 | Cognito sign-in; orgs/brands/voice; Aurora + Data API context verified; RLS tests pass |
| M1.3 | Bedrock generation + transforms with budgets; usage metered; injection fixture passes |
| M1.4 | Pages connect/disconnect; KMS encryption with tenant context; callbacks verified |
| M1.5 | Approve → publish now via SQS worker on a real Page; idempotency/reconciliation tests pass |
| M1.6 | S3 uploads + photo posts; media processor; isolation checks |
| M2.1 | EventBridge per-post schedules; sweeper; DLQ alarms; kill switch |
| M2.2 | Calendar/list/filter/reschedule/cancel/duplicate; DST tests |
| M2.3 | RSS + webhook ingestion; dedupe; SSRF tests |
| M2.4 | Automation rules, caps, SES notifications |
| M2.5 | Video + Reels |
| M3.x | Alarms, backups + restore drill, hardening (cdk-nag clean), analytics, business verification submitted |
| M4.x | Signup, billing, entitlements, Meta approvals, WAF, deletion/export, launch checklist |

---

## 10. Gotchas

- **Aurora auto-pause:** first request after idle takes ~15 s (longer after >24 h). Use Data API client retries for `DatabaseResumingException`, show a friendly loading state, keep `/api/health` DB-free, and don't hold idle connections.
- **Data API:** 1 MiB response limit → paginate; transactions must be committed/rolled back explicitly; always use parameters (never string interpolation).
- **Vercel:** server code gets AWS credentials from `@vercel/functions/oidc` (`awsCredentialsProvider` with `AWS_ROLE_ARN`) — never set `AWS_ACCESS_KEY_ID` env vars. Routes calling AWS must use the Node.js runtime. Set `maxDuration` on long AI routes. Keep functions in `iad1`.
- **EventBridge Scheduler:** schedule names must be unique per group (hence `-v<version>`); create schedules **after** the DB transaction commits; a missing schedule is caught by the sweeper.
- **SQS + Lambda:** visibility timeout ≥ 6× function timeout; batch size 1 for publishing; partial batch responses for ingest.
- **KMS:** plaintext tokens ≤ 4 KB fit direct `Encrypt`; always pass the encryption context; web role has Encrypt only.
- **Bedrock:** cross-Region inference profile IDs start with `us.`; quotas (tokens/min) are per account — request increases before launch.
- **SES:** new accounts start in the sandbox (verified recipients only) until production access is granted.
- **Meta:** `appsecret_proof` on every server call; presigned S3 URLs for Meta ≥ 5 min validity.
- **Costs:** never add NAT gateways or RDS Proxy without approval; set log retention on every log group.
