# S10/Marketing — Planning Package

AI-powered marketing and social publishing for S10 brands, built to become a SaaS product within S10/Suite. *(Working name.)*

**Status:** M1.1 (repository & AWS foundation) built locally: monorepo, Next.js 16 / React 19.3 shell (hosted on Vercel), core config/logging, CDK stacks with cdk-nag, CI. Vercel + AWS deploy pending owner approval ([runbook](docs/runbooks/m1.1-first-deploy.md)). M0.1 inventory and M0.2 Meta spike still open.

## Local development
```
corepack enable pnpm    # once; or install pnpm 10
pnpm install
pnpm dev                # http://localhost:3000
pnpm typecheck; pnpm lint; pnpm test; pnpm test:db; pnpm infra:synth; pnpm test:e2e
```
`pnpm db:up` starts Postgres 16 in Docker (needed from M1.2).

## Documents

| # | Document | What it answers |
|---|---|---|
| 01 | [Discovery report](docs/01-discovery-report.md) | What exists, what to inspect, accounts needed, risks, decisions for the owner |
| 02 | [Technical architecture](docs/02-technical-architecture.md) | AWS stack, tenancy & security, data model, scheduling, Bedrock AI layer, integrations, billing, ops |
| 03 | [Meta API & compliance research](docs/03-meta-api-compliance-research.md) | Permissions, tokens, App Review, rate limits, post types, insights, Marketing API — verified vs assumed |
| 04 | [Roadmap](docs/04-roadmap.md) | Phased milestones with tasks, acceptance criteria, tests, security, blockers |
| 05 | [Claude Code implementation guide](docs/05-claude-code-implementation-guide.md) | Conventions, monorepo layout, migrations, config/secrets, API contracts, testing, deployment, DoD |
| 06 | [Cost & launch plan](docs/06-cost-and-launch-plan.md) | AWS unit prices, three cost scenarios, pricing hypotheses, launch stages |
| — | [CLAUDE.md](CLAUDE.md) | Standing rules for Claude Code in this repo |

## Stack (summary)
Next.js 16 + React 19.3 on **Vercel** (OIDC → AWS, no keys) · **Aurora PostgreSQL Serverless v2** (scale-to-zero) via the **RDS Data API**, with row-level security for multi-tenancy · **Cognito** ("S10 Identity" pool, future S10/Suite SSO) · **EventBridge Scheduler + SQS + Lambda** for scheduled publishing · **Bedrock** (Claude) for AI · **S3**, **SES**, **KMS**, **Secrets Manager**, **CloudWatch** · **AWS CDK** for infrastructure. Non-AWS: Vercel (web hosting), GitHub, Stripe, Meta Graph API (v26.0). AI: Claude Sonnet 5.5 / Haiku 5.5 on Bedrock, streamed.

## Next steps
1. Owner answers the ⛔ decisions in 01 §7 (AWS accounts, Region, Meta business portfolio).
2. Claude Code: **M0.1** — run `scripts/discovery/Get-ProjectInventory.ps1`; owner records AWS account state.
3. Owner + Claude Code: **M0.2** — Meta spike (publish one test post via Graph API Explorer).
4. Start **M1.1** using the kickoff prompt in 05 §1.1.
