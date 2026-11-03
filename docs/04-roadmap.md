# 04 — Phased Development Roadmap

**Prepared:** 2026-10-28
**Principle:** a reliable internal content → approval → publication loop first; public SaaS only after it has run unattended for weeks.

Changes from the brief's draft sequence (and why):
- **Added M0.2 "Meta spike"** before any app code — the single biggest unknown is whether an unreviewed Business app can publish publicly visible Page posts.
- **Multi-tenancy and RLS moved into Phase 1** (not Phase 4) — cheap now, very expensive later.
- **Approval workflow moved into Phase 1** alongside manual publishing; automation in Phase 2 depends on it.
- **Video moved to Phase 2** (M2.5) so Phase 1 ships text/link/image quickly.
- **Business verification started during Phase 3** (paperwork lead time), so Phase 4 isn't blocked.

Estimates assume part-time solo development with Claude Code; treat them as rough ranges.

```
Phase 0  ██ Discovery & spikes                 ~1 week
Phase 1  █████████ Internal MVP (incl. AWS/CDK setup) ~5–7 weeks
Phase 2  ██████ Scheduling & automation        ~3–5 weeks
Phase 3  ████ Production-ready internal         ~2–4 weeks  (+ run 2–4 weeks unattended)
Phase 4  ████████ Public SaaS                   ~5–8 weeks  (+ Meta review lead time)
Phase 5  ░░░░░░░░ Expansion (ongoing)
```

---

## Phase 0 — Discovery & planning

### M0.1 Environment inventory
- **Goal:** replace every "Unverified" item in 01 with facts.
- **Prereqs:** this planning package committed to a new repo.
- **Tasks:** run `scripts/discovery/Get-ProjectInventory.ps1` against the owner's project folders; owner fills dashboard-only items (AWS account/Organizations/Identity Center state, SES Region and sandbox status, Bedrock access, Meta business portfolio, Stripe accounts, which provider S10/Mail sends with); update 01 §1 and §7.
- **Files:** `docs/discovery/inventory.md`, updates to `docs/01-discovery-report.md`.
- **Acceptance:** every row in 01 §1 is Verified or explicitly "N/A"; no secret values in any file (`git grep` for key patterns returns nothing).
- **Security:** script prints env var **names only**.
- **Blockers:** owner access to dashboards.

### M0.2 Meta spike (manual, no app code)
- **Goal:** prove Page publishing works for the owner's Pages and answer 03 Q1/Q2.
- **Tasks:**
  1. In Meta Business Suite, confirm you are an admin of the **SPEN10** business portfolio and note which Pages it holds (Loot Goblin Labs, SPEN10, S10/Mail, LimitKeep). The Meta app will be created under this portfolio at developers.facebook.com.
  2. Create a **Business-type** Meta app; add "Manage everything on your Page" use case + Facebook Login for Business; create a configuration (user access token; permissions `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management`).
  3. Graph API Explorer: get a user token → Page token for Loot Goblin Labs → `POST /{page-id}/feed` with a test message → check visibility **logged out** → delete the post.
  4. Record findings in `docs/spikes/meta-spike.md` (no tokens).
- **Acceptance:** a test post was publicly visible (or a documented workaround), permissions list confirmed, app ID recorded, app secret stored only in a password manager.
- **Blockers:** owner's Facebook account must have full control of the test Page.

---

## Phase 1 — Internal MVP

### M1.1 Repository & AWS foundation
- **Goal:** a deployable, tested, empty shell on AWS.
- **Prereqs:** owner approves D2/D3 (AWS accounts, Region) and sets up IAM Identity Center.
- **Tasks:** pnpm monorepo (`apps/web` Next.js 16 App Router + React 19.3, `apps/workers`, `packages/core`, `infra` CDK); Tailwind + shadcn/ui; ESLint/Prettier; Vitest; Playwright; Docker Postgres for local dev; zod config loader (SSM/Secrets Manager in AWS, `.env.local` locally); CDK stacks skeleton (core: KMS key, S3 bucket, SQS queues + DLQs, SNS topic; observability: AWS Budgets, log retention defaults) with `cdk-nag`; GitHub Actions CI with OIDC role for `cdk diff`; Vercel project connected to the repo (previews → dev account, `main` → prod) with OIDC → IAM web role; ADRs from 02 §15; `CLAUDE.md`.
- **Files:** `pnpm-workspace.yaml`, `apps/web/vercel.json`, `apps/web/**`, `packages/core/src/config/params.ts`, `infra/bin/app.ts`, `infra/lib/{core,observability,vercel-access,cicd}-stack.ts`, `.github/workflows/{ci,deploy-infra}.yml`, `docs/adr/*`.
- **Acceptance:** CI green (typecheck, lint, tests, `cdk synth`, cdk-nag); owner-approved deploy to the dev account; Vercel preview URL renders a placeholder dashboard that read its config from Parameter Store; Budgets alerts active; no IAM access keys anywhere.
- **Tests:** smoke unit test, config schema test, CDK assertion tests (encryption on, log retention set, no NAT), one Playwright smoke test.
- **Security:** `.env*` git-ignored; GitHub push protection; least-privilege deploy role; Vercel web role trusts only this team/project/environment and is scoped to project resources.

### M1.2 Auth, database, organizations, brands (with RLS)
- **Goal:** owner signs in with Cognito; orgs "S10" and "LimitKeep"; brands with voice profiles.
- **Tasks:** CDK `DatabaseStack` (Aurora PostgreSQL Serverless v2, min 0 / max 4 ACU, Data API on, `app_owner`/`app_rw` secrets) and `IdentityStack` (Cognito pool "s10-identity", Essentials tier, app client, managed login, post-confirmation trigger); migration runner via Data API; migration 0001 (tenancy, RLS, audit); `withDbContext` (Data API transaction + `set_config`) — **verify set_config persistence in a Data API transaction first**; session handling (`@aws-amplify/adapter-nextjs` + `aws-jwt-verify`); org switcher; brand CRUD; voice editor with versioning; seed script.
- **Files:** `infra/lib/{database,identity}-stack.ts`, `db/migrations/0001_core_tenancy.sql`, `scripts/db-migrate.ts`, `packages/core/src/db/*`, `packages/core/src/domain/{orgs,brands}/*`, `apps/web/src/server/auth/*`, `apps/workers/src/cognito-post-confirmation.ts`, `db/tests/rls_core.test.ts`.
- **Acceptance:** sign-up/sign-in/sign-out/reset via managed login; RLS tests prove cross-org isolation for every table; first request after Aurora pause succeeds (with retry) within ~20 s; voice edits version; audit entries.
- **Tests:** RLS tests (local Postgres as `app_rw`), context tests, JWT verification tests, E2E sign in → create brand (dev).
- **Security:** `force row level security`; app never connects as `app_owner`; Cognito MFA available; JWT audience/issuer checks.
- **As built (2026-11-03):** no seed data. Users sign up and create their own organizations (owner's request); the user row is created at first sign-in instead of by a Post Confirmation Lambda; sessions use our own code + PKCE flow instead of the Amplify adapter (ADR 0014, ADR 0015).

### M1.3 AI content studio v1 (Bedrock)
- **Goal:** on-brand drafts and transforms.
- **Tasks:** enable Bedrock model access (owner-approved); `AiGateway` + `ModelRouter` with `BedrockConverseProvider` (model IDs from Parameter Store, e.g. `us.anthropic.claude-sonnet-5-5`); prompt templates (`generate_post_variants`, `rewrite`, `summarize_article`, `campaign_concepts`); `BrandContextBuilder` with anti-repetition and prompt caching; structured output schemas; Studio UI with **streamed** drafts (Sonnet 5.5 generation, Haiku 5.5 transforms); `ai_generations` + `usage_events`; per-org caps and budget; CloudWatch metric for tokens.
- **Files:** `packages/core/src/ai/**`, `apps/web/src/app/(app)/b/[brandSlug]/studio/*`, `db/migrations/0002_content_ai.sql`.
- **Acceptance:** validated JSON output; Facebook length checks; usage recorded with tokens/cost; over-budget → friendly error with no Bedrock call; prompt-injection fixture passes.
- **Tests:** unit tests with `FakeAiProvider` and `aws-sdk-client-mock`; prompt snapshot tests; manual `pnpm eval:ai`.
- **Security:** IAM allows `bedrock:InvokeModel`/`Converse` only for the configured model/profile ARNs; no secrets/PII in prompts; model has no tools.
- **Note:** unassigned drafts use `posts.target_id = null` (ADR).

### M1.4 Facebook Page connection
- **Goal:** connect/disconnect Pages securely and map them to brands.
- **Tasks:** Meta app secret in Secrets Manager (owner enters it); `oauth_states`; `/api/oauth/meta/start` + `/callback`; code → long-lived user token → Page tokens; `CredentialVault` using **KMS Encrypt** with `{org_id, connection_id}` context (web role: Encrypt only); Page picker → `social_targets`; disconnect; deauthorize + data-deletion callbacks (`signed_request`); token-check Lambda (manual invoke until M2.1).
- **Files:** `packages/core/src/integrations/meta/*`, `packages/core/src/security/kms-vault.ts`, `apps/web/src/app/api/oauth/meta/*`, `apps/web/src/app/api/meta/*`, `db/migrations/0003_social.sql`, IAM/KMS policy in CDK.
- **Acceptance:** owner connects Loot Goblin Labs and SPEN10 Pages; credentials unreadable to user actors (RLS test) and undecryptable by the web role (IAM test in dev); state replay/expiry/user-mismatch rejected; disconnect deletes credentials; audit entries.
- **Tests:** KMS vault with mocked KMS (context mismatch fails); OAuth state tests; Meta fixtures; signed_request tests; CDK assertion that only the worker role has `kms:Decrypt`.
- **Blockers:** M0.2 pass.

### M1.5 Approval + publishing (text & link) + history
- **Goal:** draft → approve → publish now via the same queue path the scheduler will use.
- **Tasks:** status machine; approvals; `publish_jobs`/`publish_attempts`/`published_posts`; `publish-queue` SQS + **publish-worker Lambda** (batch size 1, reserved concurrency, DLQ); "Publish now" = DB transaction + `SendMessage`; `FacebookPageAdapter` text/link; error classification; reconciliation; duplicate guard; history with permalinks and attempt timeline; retry.
- **Files:** `packages/core/src/domain/posts/*`, `packages/core/src/publishing/*`, `packages/core/src/integrations/meta/adapter.ts`, `apps/workers/src/publish-worker.ts`, `infra/lib/workers-stack.ts`, `db/migrations/0004_publishing.sql`, `apps/web/src/app/(app)/b/[brandSlug]/{queue,history}/*`.
- **Acceptance:** real post published with permalink; duplicate SQS delivery / double click → one publish; simulated timeout → `reconciling` → no duplicate; 190 → `needs_reauth`, no retry; DLQ alarm fires on poison message; every transition audited.
- **Tests:** state machine; worker with fake adapter (success/retryable/permanent/ambiguous); concurrent claim test on Postgres; E2E with Meta mocked.
- **Security:** only approvers publish; `PUBLISHING_ENABLED=false` in dev except deliberate tests.

### M1.6 Images and media library
- **Goal:** image posts.
- **Tasks:** S3 presigned POST uploads (size/type conditions) after authz; media-processor Lambda on S3 events (sharp: validate, strip EXIF, dimensions); media library per brand; alt text; photo posts via presigned GET (5–15 min); multi-photo spike (03 Q3).
- **Files:** `packages/core/src/media/*`, `apps/workers/src/media-processor.ts`, `apps/web/src/app/(app)/b/[brandSlug]/media/*`, `db/migrations/0005_media.sql`.
- **Acceptance:** image post published; presigned URLs scoped to the org prefix and expiring; bucket blocks public access.
- **Tests:** validation tests; presign authz tests; adapter fixtures.
- **Phase 1 exit criteria:** owner publishes real posts for at least two brands for 1–2 weeks with zero duplicates or lost posts.

---

## Phase 2 — Scheduling & website automation

### M2.1 Scheduler (EventBridge Scheduler + SQS + Lambda)
- **Goal:** posts publish on time with nobody logged in.
- **Tasks:** `Scheduler` service: per-post one-time `at()` schedules in group `s10-marketing-<env>-posts` (brand time zone, flexible window off, delete after completion, DLQ) created after commit; reschedule/cancel = delete + recreate with version; sweeper Lambda (rate 15 min: missed jobs, expired locks, reconciliation, heartbeat metric); backoff retries via new schedules; `system_flags` kill switch; CloudWatch alarms (DLQs, heartbeat missing, overdue jobs).
- **Files:** `packages/core/src/scheduling/*`, `apps/workers/src/sweeper.ts`, `infra/lib/workers-stack.ts`, `db/migrations/0006_jobs_ops.sql`.
- **Acceptance:** 50 scheduled test posts (fake adapter) each run within 60 s of `run_at`; a deleted schedule is caught by the sweeper; a canceled post never publishes even if its schedule fires; kill switch stops publishing immediately.
- **Tests:** scheduler client mocks; tz/DST tests; concurrency tests; a dev-account load test.

### M2.2 Calendar, queue and scheduling UX
- **Tasks:** calendar month/week + list views; filters (brand, platform, status, date); schedule/reschedule (drag + dialog), duplicate, cancel; time-zone aware pickers; posting-frequency settings per target (e.g. max N/day, preferred slots); "next free slot" suggestion; duplicate-content warning (exact hash + trigram similarity).
- **Acceptance:** scheduling at 9:00 brand-local across a DST change publishes at correct local time; reschedule of a `scheduled` post updates its job atomically; canceled posts never publish.
- **Tests:** tz conversion tests (incl. DST); E2E schedule → reschedule → cancel.

### M2.3 Content sources (RSS/Atom + SPEN10 webhook)
- **Tasks:** `content_sources` / `source_items`; feed-poller Lambda (EventBridge Scheduler rate 30 min) → `ingest-queue` → ingest Lambda with conditional GET; WordPress REST optional parser; signed webhook endpoint with HMAC + timestamp + replay protection; SSRF-safe fetcher; article normalization (title, URL, summary, OG image); sources UI with "test feed" button. **Separately (owner approval):** add RSS route and/or webhook sender to SPEN10 repo.
- **Acceptance:** new SPEN10 article detected within one poll interval (or seconds via webhook); same article never ingested twice; private-IP URLs rejected.
- **Tests:** parser fixtures (RSS 2.0, Atom, WordPress), SSRF tests, webhook signature tests.

### M2.4 Article-to-post automation, approval policies, notifications
- **Tasks:** `automation_rules` (trigger: new article | schedule cron/rrule; action: generate N variants for targets; policy: `require_approval` default | `auto_schedule_approved_categories`; caps per day/week; quiet hours); `automation_runs` log; recurring "educational post" and "keep queue filled for next N weeks" rules; notifications (Amazon SES via `Notifier`, configuration set with bounce/complaint tracking; in-app inbox) for approvals needed, failures, token problems; daily digest.
- **Acceptance:** new article → drafts in "Awaiting approval" + email within 5 min; caps prevent >N generations/day; auto-publish policy cannot be enabled without explicit confirmation and per-day cap; disabling a rule stops further runs.
- **Tests:** rule engine unit tests; cap/budget tests; notification templates snapshot tests.
- **Security:** automation actor recorded in audit logs as `automation`; org-level automation off switch.

### M2.5 Video & Reels publishing
- **Tasks:** resumable upload flow from S3, Reels flow, status polling (delayed re-check via EventBridge Scheduler or a small Step Functions workflow), spec validation (duration, aspect ratio), disclosure UI, Reels 30/24h cap enforcement; resolve 03 Q4.
- **Acceptance:** a video and a Reel publish to the owner's Page; oversized/invalid specs rejected before upload.

---

## Phase 3 — Production-ready internal platform

### M3.1 Observability, backups, runbooks
- CloudWatch dashboard (publishes, failures, AI tokens, queue depth); alarms → SNS email/SMS (DLQs, worker errors, missing sweeper heartbeat, overdue jobs, Lambda throttles, Bedrock spend); structured JSON logs with redaction and retention; optional X-Ray tracing; client-side error reporting to a small `/api/client-errors` endpoint → CloudWatch; Aurora PITR 14 days + AWS Backup monthly snapshots (1-year retention); S3 versioning; restore drill into the dev account; runbooks in `docs/runbooks/`.
- **Acceptance:** alarm fires within 15 minutes when the sweeper stops; a point-in-time restore of prod into dev is completed and documented.

### M3.2 Security hardening & usage tracking
- Rate limiting on AI and publish actions (Postgres token bucket); Cognito MFA required for owner; CSP and security headers (`next.config.ts` headers); KMS automatic key rotation verified and re-encryption procedure documented; IAM Access Analyzer + `cdk-nag` clean; CloudTrail enabled; dependency/secret scanning; threat-model review (`docs/security/threat-model.md`); usage dashboard (AI tokens/cost, publishes) per org/brand; data retention jobs (13).
- **Acceptance:** OWASP ASVS L1 checklist reviewed; no IAM policy with wildcard data-plane actions; key rotation tested with zero failed publishes.

### M3.3 UX polish from real usage
- Onboarding checklist, empty states, keyboard shortcuts in Studio, mobile approval flow, plain-language error messages, performance budget (dashboard LCP < 2.5 s).

### M3.4 Basic analytics
- Internal publishing metrics (success/failure rates, time-to-publish); Meta engagement fetch for owned Pages (`read_insights`, `pages_read_engagement`) limited to verified fields (03 §7); UTM tagging of links; per-brand/platform performance table.
- **Meta lead-time task (start here):** submit **Business Verification** for the S10 portfolio.
- **Phase 3 exit criteria:** 2–4 weeks of unattended scheduled publishing across all four brands with no lost/duplicate posts and all failures surfaced.

---

## Phase 4 — Public SaaS

### M4.1 Customer signup, onboarding, workspaces
- Public signup via Cognito managed login (email verification; optional Google sign-in), org creation in the post-confirmation trigger, Aurora min capacity 0.5 ACU (no cold starts), SES production access, **Vercel Firewall** (rate limiting and bot rules), org creation wizard, invitations (owner/admin/editor/viewer), brand onboarding flow, terms acceptance logging, abuse controls (signup rate limits, disposable-email checks, captcha).

### M4.2 Billing, plans, entitlements, usage limits
- Separate Stripe account; plans/prices; Checkout + Portal; webhook processing; `org_entitlements`; metering enforcement; trial handling; dunning emails; internal plan for owner orgs.
- **Acceptance:** plan changes reflect in entitlements within one minute; over-limit generation blocked; scheduled approved posts never silently dropped.

### M4.3 Meta production readiness
- Business Verification complete; **Tech Provider access verification**; prototype BISU vs user token (03 Q6); App Review submission (permissions list, screencasts, test user/Page, reviewer instructions); privacy policy, data deletion page, terms; Data Use Checkup calendar.
- **Blockers:** Meta review timelines (plan for multiple rounds).

### M4.4 Account lifecycle & compliance
- Account/org deletion (30-day grace, hard delete, Meta revoke), data export (JSON/CSV), retention jobs, DPA/privacy docs reviewed by a lawyer, cookie consent if analytics used, support inbox, status page.

### M4.5 Launch
- Waitlist → batches; pricing page; docs/help center; launch checklist; on-call/alerting to phone.

---

## Phase 5 — Expansion (prioritize by customer demand)

| Item | Notes |
|---|---|
| Instagram publishing | Reuse Facebook Login for Business; JPEG conversion; carousel; publishing limit endpoint |
| More networks (LinkedIn, Threads, X, YouTube community) | Each is a new adapter + review process; verify API access/pricing per network first |
| More CMS integrations | WordPress app-password plugin, Ghost, Webflow, Shopify blog |
| Analytics & reporting | Scheduled reports, best-time suggestions |
| AI images | Image prompt generation → provider (Gemini image or OpenAI image models) with brand style presets; human selection; labeled AI-generated |
| Paid ads module | Draft-only → approval-gated launch; spend caps; special ad category handling; Marketing API Full Access |
| Team collaboration | Comments, assignments, approval chains |
| Advanced automation | A/B variants, evergreen recycling with cool-down |
| S10/Suite SSO | OIDC federation with S10 Identity (Architecture §3.4) |

---

## Cross-cutting definition of done (every milestone)

1. Typecheck, lint, unit, DB/RLS and relevant E2E tests pass in CI.
2. New tables have RLS + isolation tests; new endpoints have authz tests.
3. No secrets in code, logs, fixtures or docs.
4. Migrations are forward-only and reversible by a documented follow-up migration.
5. `docs/CHANGELOG.md` updated; ADR added for any significant decision.
6. Feature verified manually on a preview deployment; production deploy only with owner approval.
