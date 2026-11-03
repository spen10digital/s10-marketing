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
