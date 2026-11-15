# Changelog

## 2026-10-28 — Phase 0 planning package
- Added discovery report, technical architecture, Meta API & compliance research, roadmap, Claude Code implementation guide, cost & launch plan.
- Added CLAUDE.md and read-only discovery inventory script.

## 2026-10-29 — Revision 2: AWS-first
- Re-architected on AWS per owner preference: Amplify Hosting (Next.js 15), Aurora PostgreSQL Serverless v2 + RDS Data API, Cognito ("s10-identity" pool), EventBridge Scheduler + SQS + Lambda, Bedrock (Claude), S3, SES, KMS, Secrets Manager/Parameter Store, CloudWatch/SNS, AWS CDK.
- Rewrote 02 (architecture), 05 (implementation guide), 06 (costs); updated 01 (accounts, risks, decisions), 04 (Phase 1–4 milestones), CLAUDE.md, README.
- Non-AWS services retained only where AWS has no equivalent: GitHub, Stripe, Meta.

## 2026-10-29 — Owner decisions
- D2: separate dev/prod AWS accounts under one AWS Organization.
- D2b: IAM Identity Center (SSO) instead of IAM access keys (default; explanation in 01 §9).
- D3: Region us-east-1 (N. Virginia), matching S10/Mail's SES.
- D7: SES in us-east-1; dedicated notification subdomain recommended.
- D5: Meta app owned by the existing SPEN10 business portfolio (Meta Business Suite).

## 2026-11-01 — M1.1 Repository & AWS foundation (local part)
- pnpm monorepo: `apps/web` (Next.js 15.5 App Router, Tailwind 4, placeholder dashboard, DB-free `/api/health`, security headers), `apps/workers` (placeholder), `packages/core` (zod config loader for env/Parameter Store, redacting JSON logger, `AppError`/`Result`, `PRODUCT_NAME`), `infra` (CDK).
- CDK stacks per environment: **Core** (KMS token key with rotation, private versioned media bucket, publish/ingest SQS queues with DLQs, ops-alerts SNS topic, Parameter Store config with kill switches off), **Observability** (monthly budget alerting at $25/$75/$150 actual + forecast, Cost Anomaly Detection), **Hosting** (Amplify WEB_COMPUTE app, compute role scoped to its Parameter Store path, SSR log group with 30-day retention), **Cicd** (GitHub OIDC diff/deploy roles; only when `githubRepo` is set).
- cdk-nag v3 `AwsSolutionsChecks` fails synth on unacknowledged findings; a `Guardrails` aspect rejects NAT gateways, RDS Proxy and log groups without retention (ADR 0011).
- Tests: core unit tests, CDK assertion tests (encryption, retention, no NAT/VPC, no wildcard actions, kill switches, OIDC trust), guardrail tests, Playwright smoke test.
- CI (`ci.yml`), manual approval-gated `deploy-infra.yml`, `amplify.yml`, `docker-compose.yml` (Postgres 16), ADRs 0001–0011, `docs/config-inventory.md`, `docs/runbooks/m1.1-first-deploy.md`.
- Not done (owner approval required): AWS bootstrap/deploy, GitHub repo + Amplify connection, live Budgets.

## 2026-11-01 — Owner decision: web hosting on Vercel (ADR 0012)
- Web app moved from Amplify Hosting to **Vercel Pro**; upgraded to **Next.js 16.4** and **React 19.3**; streaming allowed. Everything else stays on AWS as planned.
- `HostingStack` (Amplify) replaced by `VercelAccessStack`: Vercel OIDC provider (team issuer) + `s10-marketing-<env>-web-runtime` role (dev trusts preview/development, prod trusts production), read-only on its Parameter Store path. Created when `--context vercelTeam=<slug>` is set.
- Web server code gets AWS credentials via `@vercel/functions/oidc` (`AWS_ROLE_ARN`); no access keys. Added `apps/web/vercel.json` (region `iad1`); removed `amplify.yml`.
- AI models: Claude Sonnet 5.5 (generation) and Claude Haiku 5.5 (quick edits) on Bedrock, chosen for price/performance; Studio output will be streamed (M1.3).
- Updated CLAUDE.md, 01, 02, 04, 05, 06, README, config inventory and the first-deploy runbook. Phase 1 cost estimate rises by about $20/month (Vercel Pro).

## 2026-11-03 — Workload region us-east-2 (ADR 0013)
- CDK bootstrap in us-east-1 was denied by the organization's root SCP, which only allows regional services in us-east-2. Owner chose to follow it rather than loosen the guardrail.
- Region switched to **us-east-2** in the config schema, web server, CDK environments and CI; Vercel functions moved to `cle1`. Revised D3/D7 and updated CLAUDE.md, 01, 02, 05, 06, runbook and ADR 0012.
- Dev stacks deployed (owner) and the Vercel preview verified against AWS via OIDC.
- Hosted deployments (Vercel, Lambda) now refuse to start without `APP_ENV=dev|prod` (`assertDeploymentEnv`, run from `apps/web/src/instrumentation.ts` and `loadConfig`), instead of silently running as `local`. Vercel **Production** needs `APP_ENV=prod` and `AWS_ROLE_ARN` before `main` is deployed.
- GitHub OIDC: the repo uses GitHub's immutable subject (`repo:owner@id/repo@id:…`), so the Cicd roles now trust that exact form. Non-secret CDK context (`vercelTeam`, `githubRepo`) moved to `infra/cdk.json`; CI diffs all stacks with `--method=template` (the diff role can only read).

## 2026-11-03 — M1.2 Auth, database, organizations, brands (with RLS)
- **Migration `0001_core_tenancy`:**
  - roles `app_owner` and `app_rw`, and request-context functions;
  - tables `users`, `user_identities`, `organizations`, `organization_members`, `brands`, `brand_voice_profiles` (append-only versions), `audit_logs` (written by a trigger; records changed column names only) and `system_flags` (kill switches off);
  - RLS enabled **and forced** everywhere, composite foreign keys, and column-level update grants.
  - SECURITY DEFINER helpers: `is_org_member`, `has_org_role`, `register_user`, `resolve_user`, `create_organization` (ADR 0015).
- **`packages/core`:**
  - `db/`: a Drizzle client for local Postgres or the RDS Data API, `withDbContext` (transaction-local `set_config`), retry while Aurora resumes, the migration runner and SQL splitter;
  - `domain/`: orgs, brands, voice and a permissions matrix;
  - `auth/`: Cognito OAuth code + PKCE helpers.
- **CDK:**
  - `DatabaseStack`: Aurora PostgreSQL 16 Serverless v2, 0–4 ACU with auto-pause, Data API, isolated VPC without an internet gateway or NAT, `app_owner` and `app_rw` secrets, and `db-*` parameters.
  - `IdentityStack`: the `s10-identity-<env>` pool (Essentials, optional TOTP MFA, retained on delete), managed login v2, and a public PKCE client.
  - The web role gets Data API access scoped to the cluster and the `app_rw` secret.
  - `appUrls` context: dev = the `develop` alias + localhost; the prod Identity stack waits for its domain.
- **Web:**
  - sign-in, sign-up, refresh and POST-only sign-out routes with HTTP-only cookies (ADR 0014);
  - an `(app)` route group that requires a session;
  - onboarding that creates your first organization (**no seeded orgs or brands**, owner's request);
  - an org switcher, dashboard, brand create/edit/archive, and a voice editor with version history;
  - a `/signed-out` page.
- **Scripts:** `pnpm db:migrate` (local, or `--aws --env dev`) and `pnpm db:verify-context --env dev` (proves the Data API `set_config` assumption).
- **Tests:**
  - 26 RLS and tenancy tests on Postgres 16, run as `app_rw`: isolation per table, role matrix, composite FK, audit immutability, context not leaking, system actor;
  - unit tests for the splitter, context, retry, OAuth and domain;
  - CDK assertions for Database, Identity and web-role scoping;
  - Playwright tests for the auth redirect, the signed-out page and POST-only sign-out, plus an opt-in signed-in flow for dev.
- **Changes from the roadmap:**
  - no Cognito Post Confirmation Lambda (user rows are created at first sign-in);
  - no `@aws-amplify/adapter-nextjs`;
  - a self-serve create-organization flow arrives now instead of in Phase 4.
- **Not done (owner approval required):** deploying the Database and Identity stacks, running migrations on dev Aurora, `db:verify-context`, and the manual sign-in check (`docs/runbooks/m1.2-database-and-sign-in.md`).

## 2026-11-03 — M1.2 deployed to dev; M1.3 scope extended
- **Deployed (owner-approved):** the dev Database, Identity and VercelAccess stacks (Aurora PostgreSQL **16.13**; 16.6 is no longer offered). Migration `0001_core_tenancy` is applied, and `db:verify-context` passed on the real Data API: `app_rw`, context persists within a transaction and doesn't leak. The owner checked sign-up → create organization → brands → voice versions on the `develop` alias.
- **Fixes during deploy:**
  - `db:verify-context` now pages through Parameter Store results.
  - `infra/cdk.context.json` is committed so synth always picks the same availability zones.
  - Deploys need `--context alertEmail=…`, now noted in the runbook.
- **GitHub (owner-approved):** auto-merge allowed on the repository. `develop` is protected, with only one rule: the CI `checks` job must pass (no required reviews, admins not restricted).
- **Roadmap:** M1.3 now includes a **Brand Voice assistant**: draft from website, guided setup, tune suggestions and sample posts, always as proposals saved as a normal new version. The SSRF-safe fetcher moves forward from M2.3.

## 2026-11-03 — M1.3 AI content studio v1 (Bedrock) + Brand Voice assistant
- **Migration `0002_content_ai`:**
  - tables `org_entitlements` (read-only for the app), `ai_generations`, `usage_events` (append-only), `content_items`, `posts` and `post_revisions` (append-only), plus the `app.post_status` enum;
  - RLS enabled and forced on all of them; editors create drafts and generations as themselves; only drafts can be edited; a finished generation can't change; column-level updates; composite foreign keys.
- **`packages/core/src/ai`:**
  - `AiGateway` with a `GenerationLedger` (budget reservation under a per-org lock, real cost afterwards, ADR 0016), `ModelRouter` (model IDs from Parameter Store), `BedrockConverseProvider` (ConverseStream, structured JSON output, prompt-cache points, no tools), `FakeAiProvider`, and CloudWatch token/cost metrics;
  - versioned prompt templates for `generate_post_variants`, `rewrite`, `summarize_article`, `campaign_concepts`, `voice_draft`, `voice_tune`, `voice_samples`; outside text goes in delimited `<untrusted_data>` blocks;
  - `BrandContextBuilder` (voice in the cached block, recent posts after it for anti-repetition), zod output schemas, Facebook checks (63,206-character limit, long-post warning, avoided phrases, links that weren't provided), price table for Sonnet 5.5 / Haiku 5.5.
- **`packages/core/src/sources`:** the SSRF-safe fetcher pulled forward from M2.3 (address check inside the socket's DNS lookup, private/loopback/link-local/mapped ranges blocked, ≤3 re-checked redirects, 10 s, 2 MB, ports 80/443, `robots.txt`), plus HTML-to-text and a website reader (home + up to 4 same-site pages).
- **CDK:**
  - Core publishes `ai-model-generate`, `ai-model-fast` and `ai-default-monthly-budget-usd`;
  - the web role may invoke only the two US inference profiles (and their foundation models only through those profiles) and write metrics only to `S10Marketing/AI`.
- **Web:**
  - `POST /api/ai/stream` (NDJSON, same-origin JSON only, org from the session; ADR 0017);
  - **Studio** at `/b/[brandSlug]/studio`: streamed post variants (optionally from an article), Shorten / Expand / Fit for Facebook / Change tone with Haiku, campaign ideas, save as an unassigned draft (ADR 0018), recent drafts, and this month's AI spend;
  - **Brand Voice assistant** on the brand page: draft from website, guided setup, tune (accept/dismiss each suggestion), try it (sample posts). Output is always a proposal shown against the saved version; saving still creates a normal new version.
- **Tests:**
  - unit tests for the gateway, budgets (fake ledger), pricing, JSON schema, partial JSON, Facebook checks, voice suggestions, prompt snapshots, the prompt-injection fixture, and Bedrock request/stream/error mapping with `aws-sdk-client-mock`;
  - SSRF tests against a local server (private and mapped addresses, mixed DNS answers, redirects into private ranges, redirect loops, size, time, content type, robots.txt);
  - DB tests for 0002 (isolation, role matrix, draft-only edits, immutable generations, concurrent budget reservations, caps, entitlements). DB test files now run one at a time;
  - CDK assertions for the Bedrock and metrics permissions and the new parameters; Playwright checks that the Studio needs sign-in and the stream refuses cross-site and signed-out requests.
- **Scripts:** `pnpm eval:ai --env dev` (manual, costs money): variants, rewrite, samples and the injection fixture against real Bedrock, with tokens and cost.
- **Not done (owner approval required):** enabling Bedrock model access, checking the org SCP against cross-Region inference, deploying Core + VercelAccess, migrating dev, and the manual check (`docs/runbooks/m1.3-ai-studio.md`).

