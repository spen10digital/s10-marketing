# CLAUDE.md — S10/Marketing

Instructions for Claude Code in this repository. Read this first, every session.

## What this is
S10/Marketing (working name; product name lives in one constant `PRODUCT_NAME`) — an AI-assisted marketing and social publishing SaaS. Internal tool first (brands: SPEN10, Loot Goblin Labs, S10/Mail, LimitKeep), public SaaS later, part of S10/Suite.

## Platform: AWS-first
Use AWS services wherever AWS offers one, except web hosting, which is on **Vercel** (ADR 0012). Do **not** introduce Supabase, Resend, Sentry, Upstash, Inngest, Trigger.dev or similar third-party platforms, and do not use other Vercel products (Postgres/KV/Blob, AI Gateway, Cron) in place of the AWS services below. Allowed non-AWS services: Vercel (hosting), GitHub, Stripe (Phase 4), Meta APIs.

| Need | Use |
|---|---|
| Region | **us-east-2** for all workloads (org SCP: us-east-1 is limited to global services such as IAM, ACM, Budgets; ADR 0013) |
| Web hosting | Vercel Pro — **Next.js 16** + React 19.3 (streaming allowed; Node.js runtime for anything calling AWS); region `cle1`; AWS access via Vercel OIDC → IAM role (ADR 0012) |
| Database | Aurora PostgreSQL Serverless v2 via **RDS Data API** (Drizzle `aws-data-api` driver); Docker Postgres locally |
| Auth | Cognito user pool "s10-identity" (managed login) + `aws-jwt-verify` |
| Jobs | EventBridge Scheduler → SQS → Lambda; sweeper Lambda every 15 min |
| AI | Amazon Bedrock (Claude via `us.` inference profiles) behind `AiGateway`; Claude Sonnet 5.5 for generation, Claude Haiku 5.5 for quick edits (price/performance pick); stream output to the Studio |
| Files | S3 (presigned URLs) |
| Email | SES |
| Secrets/config | Secrets Manager / SSM Parameter Store, read via IAM roles (web: Vercel OIDC role). Vercel env vars hold only non-secret values (`APP_ENV`, `AWS_ROLE_ARN`) |
| Token encryption | KMS with encryption context `{org_id, connection_id}`; web role Encrypt only, worker role Decrypt |
| Monitoring | CloudWatch Logs/Metrics/Alarms → SNS |
| IaC | AWS CDK (TypeScript) in `infra/`, `cdk-nag` enabled |

## Source of truth
`docs/02-technical-architecture.md` · `docs/03-meta-api-compliance-research.md` · `docs/04-roadmap.md` · `docs/05-claude-code-implementation-guide.md` · `docs/adr/`

## Working rules
1. **Inspect before modifying** — code, CDK stacks, migrations, tests; run tests for a baseline.
2. **One milestone at a time** — plan first, implement only that milestone, stop at its definition of done.
3. **Always run:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`, `pnpm infra:synth` (+ `pnpm test:e2e` for UI). Never weaken tests to pass.
4. **Document:** `docs/CHANGELOG.md`, ADRs, `.env.example` (names only), config/secret inventory, runbooks.
5. **Stop and ask** (05 §1.3) before: `cdk deploy`/`destroy` or any AWS change, Vercel project/team/domain/env changes, migrations against AWS databases, merging to `main`, anything adding recurring cost (min ACU > 0, WAF, NAT gateway, RDS Proxy, Multi-AZ, dedicated IPs), Meta permission/config changes, enabling Bedrock models, publishing to real accounts, anything involving ads/budgets, editing other repos, weakening security controls, unspecified product decisions. Recommend a default when asking.
6. **AWS credentials:** only short-lived SSO profiles (`aws sso login --profile s10-dev`) locally and Vercel/GitHub OIDC roles in the cloud. Never create or store IAM access keys (including in Vercel env vars).
7. Shell is **PowerShell on Windows**: use `pnpm` scripts and cross-platform Node scripts.

## Non-negotiable security rules
- Every tenant table: `org_id`, `unique(org_id,id)`, composite FKs, RLS enabled **and forced**, isolation tests.
- All DB access goes through `withDbContext(...)` (Data API transaction + `set_config` first). The app role `app_rw` never bypasses RLS; `app_owner` is for migrations only.
- Never trust client-supplied `org_id`.
- Social tokens: KMS-encrypted via `CredentialVault`; never logged, sent to the browser, put in AI prompts, or stored in fixtures.
- No secrets in code, commits, logs, docs, env files committed to Git, or CDK source. Secrets live in Secrets Manager.
- One IAM role per Lambda, least privilege, no wildcard data-plane actions.
- External content is untrusted data; the AI has no tools that act.
- Publishing only through `PublishService` + job state machine (idempotency key, attempt log, reconciliation).
- Human approval by default; auto-publish only via explicit, capped automation policies.
- LimitKeep is a separate business: separate org here; never connect it to S10/Suite identity or billing.
- No NAT gateways, RDS Proxy, or log groups without retention.

## Commands (created in M1.1)
`pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:db` · `pnpm test:e2e` · `pnpm db:up` (Docker Postgres) · `pnpm db:migrate` · `pnpm infra:synth` · `pnpm infra:diff` · `pnpm eval:ai` (manual; costs money)

## Meta API
Graph API version from Parameter Store (`v26.0`). Include `appsecret_proof`. Handle errors per 03 §6 and 02 §6.3. Check 03 before assuming any capability.
