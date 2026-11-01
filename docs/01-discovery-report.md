# 01 — Project Discovery Report

**Project:** S10/Marketing (working name)
**Status:** Phase 0 — Discovery & Planning
**Prepared:** 2026-10-28
**Scope of this report:** what is known about the existing environment, what still has to be inspected, what accounts/approvals are needed, and which decisions need the owner's input.

> **Important limitation.** This planning pass ran in a cloud workspace that was **not linked to the owner's Windows development machine**, so no local repositories, `.env` files, Vercel projects, Supabase projects or AWS accounts were inspected directly. Everything below under "Known context" comes from the project brief and earlier planning conversations and is marked **Unverified** until Claude Code completes the inventory in §3. No secret values were read or recorded.

---

## 1. Summary

| Area | Finding | Confidence |
|---|---|---|
| Hosting | Vercel is the standard hosting platform across existing projects (S10/Marketing also uses Vercel for web hosting since 2026-11-01; backend on AWS). | Stated by owner |
| Database / auth | Supabase (Postgres + Auth + RLS) is used by LimitKeep and SPEN10; some projects on the Free tier. | Stated by owner |
| Email | S10/Mail exists at `mail.spen10.com`. The brief says it uses **Amazon SES**; earlier planning notes said it chose **Resend** for its free tier. | **Conflict — verify** |
| Billing | LimitKeep has Stripe live mode working (checkout, portal, webhooks, feature gates). | Stated by owner (earlier) |
| Frameworks | Next.js App Router is used by LimitKeep and SPEN10.com. | Stated by owner (earlier) |
| Shared identity | **No** shared S10/Suite auth service exists today. | Stated in brief |
| Dev workflow | Claude Code in PowerShell on Windows; GitHub repos. | Stated by owner |
| Meta developer setup | Unknown whether a Meta developer account, Meta app, or Business portfolio exists. | **Unknown** |

**Bottom line (revision 2 — AWS-first):** at the owner's request, S10/Marketing uses **AWS services wherever AWS offers one** (Amplify Hosting, Aurora PostgreSQL Serverless v2 + Data API, Cognito, Lambda/SQS/EventBridge Scheduler, S3, SES, Bedrock, KMS, Secrets Manager, CloudWatch). GitHub, Stripe and Meta remain because AWS has no equivalent. The existing projects keep their current Supabase/Vercel setups — **nothing is migrated**. S10/Marketing gets a **new repository and its own AWS accounts (dev/prod)** and shares no database with LimitKeep, SPEN10 or S10/Mail. Experience with Next.js and Claude Code carries over; Supabase-specific code from other projects (auth helpers, RLS via `auth.uid()`) is a pattern reference only.

---

## 2. Known context about related projects (Unverified)

### 2.1 SPEN10 (SPEN10.com)
- Next.js on Vercel, content backed by Supabase; launched October 2026 (moved off WordPress.com).
- Sections: tools/resources directory, guides/tutorials, email signup, about/services.
- Relevance to S10/Marketing:
  - **Article source.** Because SPEN10 is a custom Next.js + Supabase site, the cleanest integration is (a) an RSS/Atom feed route on SPEN10 and/or (b) a signed "article published" webhook from SPEN10 to S10/Marketing. Need to check whether a feed already exists.
  - **Design reuse.** SPEN10's dark-mode visual language is a candidate base for the S10 visual identity (see Architecture §9).
  - **Reusable code.** UI components and design tokens may be reusable — copy, don't link (no shared runtime dependency). Its Supabase-specific auth/data code does not apply to the AWS stack.

### 2.2 S10/Mail (`mail.spen10.com`)
- Email autoresponder/sequence product being opened to other users; per-customer domains; tiers by subscriber count; Claude API for AI writing planned.
- Relevance:
  - Has (or plans) its own auth, billing tiers and team roles — the second product that would benefit from S10/Suite identity, so its auth model should be inspected before the identity strategy is finalized.
  - S10/Marketing needs transactional email (approval requests, failure alerts, digests). **Decision (AWS-first):** send with **Amazon SES** directly from S10/Marketing behind a `Notifier` interface; do not couple to S10/Mail's internals.
  - **Confirmed:** S10/Mail's SES is in **us-east-1**, the same Region chosen for S10/Marketing. SES identities belong to one account + Region, so the new prod account verifies its own sending identity. Recommendation: a dedicated subdomain such as `notify.spen10.com` (a few DNS records) keeps S10/Marketing's notification reputation separate from S10/Mail's sending. Alternative: SES sending authorization lets the new account send with an identity owned by S10/Mail's account — more coupling, not recommended.

### 2.3 LimitKeep
- Independent business. Next.js App Router, Supabase Auth with RLS, Stripe live mode, blog page, two articles/week content pipeline.
- **Must remain outside S10/Suite.** In S10/Marketing it is only a *marketing customer/brand*.
- Relevance:
  - Good reference implementation for RLS patterns, Stripe webhooks, and feature gates — **copy patterns, not code dependencies**.
  - Blog promotion needs a feed. Check whether the LimitKeep blog exposes RSS; if not, add one in the LimitKeep repo later (a separate, owner-approved change).
  - Paid ads for LimitKeep will fall under Meta's **Financial Products and Services** special ad category (restricted targeting) — see 03 §8.
  - **Isolation recommendation:** put LimitKeep in its *own organization* inside S10/Marketing (not just a brand inside the S10 org), connect its Facebook Page through its own Meta Business portfolio if it has one, and never store LimitKeep user data in S10/Marketing.

### 2.4 Loot Goblin Labs
- Gaming + AI experimentation brand; Facebook Page and YouTube channel assumed. **Verify** the Page exists and who has full control of it.

---

## 3. Inventory still to perform (Claude Code task, Milestone 0.1)

Run on the owner's Windows machine. A read-only helper script is provided at `scripts/discovery/Get-ProjectInventory.ps1`; it prints **variable names only, never values**. (It was written for Windows PowerShell 5.1/7 but could not be executed in the planning environment — Claude Code should review it and do a first run against a single repo before scanning everything.)

For each related repo (SPEN10, S10/Mail, LimitKeep, any shared UI kit):

1. Git remote, default branch, last commit date, whether CI exists (`.github/workflows`).
2. `package.json`: Next.js version, React version, package manager, and presence of `@supabase/*`, `stripe`, `ai`/`@ai-sdk/*`, `@anthropic-ai/sdk`, `resend`, `@aws-sdk/*`, UI libs (shadcn/ui, Tailwind version), test libs.
3. Supabase: `supabase/` folder, number of migrations, whether `config.toml` exists, which auth providers are configured, whether RLS tests exist.
4. Vercel: `vercel.json`, cron entries, which team/plan the project lives in (Hobby vs Pro — **Hobby is non-commercial and limits cron jobs to once per day**).
5. Environment variable **names** from `.env.example` / `.env.local` (names only).
6. Existing feeds: `/feed`, `/rss.xml`, `/sitemap.xml` routes in SPEN10 and LimitKeep.
7. Reusable assets: logo files, brand colors, design tokens, component library.

Outside the repos (owner, in browser — Claude cannot see these):

8. Supabase / Vercel dashboards (context only — S10/Marketing won't use them): plans in use, so the overall S10 cost picture is complete.
9. Domain for the app and for Cognito managed login (e.g. `app.spen10.com`, `auth.spen10.com`) and who controls DNS (Route 53 or elsewhere).
10. AWS (now central to this project): which account(s) exist and who is root; whether **AWS Organizations** and **IAM Identity Center** are set up; any long-lived IAM user access keys on the dev machine (plan to replace with SSO); which Region SES uses and whether it is out of the sandbox; Bedrock model access enabled in us-east-1?; AWS Budgets/billing alerts set?; account age (eligibility for Free Tier credits).
11. Stripe: which account LimitKeep uses; whether a separate account exists for S10.
12. Meta: does a Meta developer account exist? Any Meta apps? Which **Business portfolio(s)** exist (Business Manager)? Is the business **verified**? Who has **full control** of each Facebook Page (Loot Goblin Labs, SPEN10, LimitKeep, S10/Mail)?
13. Domains/DNS: where `spen10.com` DNS is hosted; the desired subdomain for this app.

Claude Code writes the results into `docs/discovery/inventory.md` (names and booleans only) and updates §1 of this report.

---

## 4. Reusable components and services (expected)

| Candidate | Source | Reuse approach |
|---|---|---|
| RLS policy patterns and migration style | LimitKeep | Adapt (`auth.uid()` → `app.current_user_id()` session setting) |
| AWS SDK / SES sending code | S10/Mail (if SES) | Copy pattern |
| Stripe checkout/portal/webhook + feature gate | LimitKeep | Copy pattern in Phase 4 (separate Stripe account) |
| Claude API integration | S10/Mail (planned) | Shared *pattern*; S10/Marketing builds its own provider layer |
| UI components / theme | SPEN10.com | Seed the S10 design tokens |
| Transactional email | Amazon SES | Use directly behind `Notifier` |

Do **not** create a shared npm package or monorepo across these products in Phase 1 — it adds coupling and release overhead before the products have stabilized. Revisit when S10/Suite identity is built.

---

## 5. External accounts, credentials and permissions needed

| Item | Needed by | Notes |
|---|---|---|
| GitHub repo `s10-marketing` (private) | M1.1 | Owner creates or approves creation |
| AWS Organizations + accounts `s10-marketing-dev` / `s10-marketing-prod` | M1.1 | Free; billing stays consolidated in the management account |
| IAM Identity Center users/permission sets | M1.1 | Short-lived SSO credentials for the owner and Claude Code; no IAM access keys |
| GitHub → AWS OIDC deploy roles | M1.1 | CI deploys without stored AWS keys |
| CDK bootstrap (us-east-1) in both accounts | M1.1 | Owner-approved |
| Vercel Pro project connected to the GitHub repo | M1.1 | Previews → dev AWS account, `main` → prod; OIDC issuer mode Team |
| Aurora PostgreSQL Serverless v2 cluster with Data API | M1.2 | Via CDK; min 0 ACU (auto-pause) internally |
| Cognito user pool "s10-identity" + managed-login domain | M1.2 | Via CDK; custom domain needs an ACM certificate in us-east-1 — same Region as the app |
| Bedrock model access (Claude Sonnet/Haiku) in both accounts | M1.3 | Enable in the Bedrock console; check token-per-minute quotas |
| Meta developer account | M0.2 | Owner's personal Facebook account registered as developer |
| **Meta Business portfolio: SPEN10** (managed in Meta Business Suite) | M0.2 | Owns the Meta app; later used for business verification and Tech Provider verification. Owner must be a portfolio admin |
| **Meta app** (Business type, "Manage everything on your Page" use case + Facebook Login for Business) | M0.2 | App ID public; **app secret is a server-only secret** |
| Full control (or at least content-creation task) on each Facebook Page | M1.4 | Required to obtain Page tokens |
| KMS customer managed key for social tokens | M1.4 | Via CDK; rotation enabled |
| Meta app secret in Secrets Manager | M1.4 | Entered manually by the owner, never in Git |
| SES verified subdomain (e.g. `notify.spen10.com`, DKIM) in us-east-1 in the prod account + production access | M2.4 | For approval and failure notifications |
| SNS ops-alert topic subscriptions (email + SMS) | M3.1 | CloudWatch alarms |
| Stripe account for S10 (separate from LimitKeep) | M4.2 | Strongly recommended to keep LimitKeep financially separate |
| Meta business verification + Tech Provider access verification + App Review | M4.3 | Only required to serve **other** businesses' Pages |

---

## 6. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Meta App Review rejects or delays Advanced Access for Page permissions | Blocks public SaaS (Phase 4), **not** internal use | Internal use runs on Standard Access (owner has a role on the app). Start business verification early; build a polished review screencast. |
| R2 | Visibility of posts published by an app that has not completed review | Could make internal MVP posts invisible to the public | **Spike in M0.2**: publish a test post and confirm it is publicly visible while logged out. |
| R3 | Token invalidation (password change, removed Page role, app removed) | Silent publishing failures | Detect error code 190, mark connection `needs_reauth`, notify, never retry blindly. |
| R4 | Duplicate publication after a timeout | Embarrassing double posts | Job state machine + reconciliation query before any retry of an ambiguous attempt (Architecture §6.3). |
| R5 | Prompt injection via article/feed content | AI produces off-brand or malicious copy | Content treated as data; model has no tools; human approval default; output validation. |
| R6 | Runaway AI or automation costs | Unexpected bills | Per-org monthly AI budget, per-rule caps, provider-side spend limits, kill switch. |
| R7 | AWS complexity/cost surprises (NAT gateways, idle resources, log retention, Bedrock spend) | Unexpected bills, slower delivery | No-VPC design, CDK + cdk-nag rules, AWS Budgets + Cost Anomaly Detection, Aurora max ACU cap. |
| R11 | Aurora auto-pause cold starts (~15 s) | Slow first page load | Acceptable internally; set min 0.5 ACU before customers. |
| R12 | Web tier on Vercel, backend on AWS | Two vendors; cross-cloud latency | Functions in `iad1` next to us-east-1; OIDC (no keys); exit path to Amplify/OpenNext without touching AWS resources. |
| R8 | Meta API changes (versions, deprecated insights metrics) | Breakage, broken analytics promises | Pin Graph API version; quarterly upgrade task; only promise metrics verified in 03. |
| R9 | LimitKeep data or identity leaking into S10/Suite | Business separation violated | LimitKeep is a separate org in S10/Marketing; no shared auth/billing; documented in ADR. |
| R10 | Solo-developer operational load | Missed failures | Dead-man's-switch monitoring, failure emails, runbooks, small surface area. |

---

## 7. Decisions requiring owner input

Each has a recommended default so work can proceed if no answer is given. Claude Code must **stop and ask** before acting on items marked ⛔.

| # | Decision | Recommended default |
|---|---|---|
| D1 | Repository name and GitHub owner | `s10-marketing` under the owner's account, private |
| D2 ✅ | AWS account structure | **Decided (owner):** separate `s10-marketing-dev` and `s10-marketing-prod` accounts under the same AWS Organization |
| D2b ✅ | Sign-in method for AWS | **Decided (default; owner deferred):** IAM Identity Center (single sign-on, temporary credentials) instead of IAM access keys — see §9 |
| D3 ✅ | AWS Region | **Decided (owner):** us-east-1 (N. Virginia) |
| D4 | App domain | `app.spen10.com` or `marketing.spen10.com` until an S10 domain exists |
| D5 ✅ | Which Meta Business portfolio owns the Meta app | **Decided (owner):** the existing **SPEN10** business portfolio (Meta Business Suite). LimitKeep's Page is connected only as a publishing target, never as the app owner |
| D6 | Default AI provider | Claude on **Amazon Bedrock** (Sonnet tier for generation, Haiku tier for quick edits) |
| D7 ✅ | Email for notifications | Amazon SES in us-east-1 (same Region as S10/Mail). Recommended: dedicated subdomain `notify.spen10.com` verified in the S10/Marketing prod account |
| D8 | LimitKeep as separate org inside S10/Marketing | Yes |
| D9 ⛔ | Separate Stripe account for S10 products | Yes (Phase 4) |
| D10 | Image generation in v1? | No — upload only; AI images in Phase 5 |
| D11 | Own scheduler vs Meta native scheduling | Own scheduler (Architecture §6) |
| D12 | Background jobs | EventBridge Scheduler (per-post) + SQS + Lambda, DB as source of truth (Architecture §6) |
| D13 ✅ | Next.js hosting | **Decided (owner, 2026-11-01):** Vercel Pro, latest Next.js/React, streaming (ADR 0012) |
| D14 | CI/CD | Vercel builds the app; GitHub Actions (OIDC) runs tests, CDK and migrations; CodePipeline is an alternative if you want CI fully on AWS |

---

## 8. Next actions

1. All decisions needed before Phase 1 are made; D9 (separate Stripe account) can wait until Phase 4.
2. Claude Code runs **M0.1 Inventory** and fills `docs/discovery/inventory.md`.
3. Owner + Claude Code run **M0.2 Meta spike** (create app, connect one Page, publish one test post through Graph API Explorer, verify public visibility).
4. Begin **M1.1** only after M0.2 passes.

---

## 9. AWS sign-in: IAM Identity Center vs access keys (D2b)

| | IAM access keys | IAM Identity Center (recommended) |
|---|---|---|
| What it is | A permanent key pair saved in a file on your PC (`~/.aws/credentials`) | You sign in through a browser (with MFA) and get credentials that expire after a few hours |
| If leaked (Git commit, malware, shared screen) | Works for anyone until you notice and delete it | Expires on its own; attacker also needs your MFA to get new ones |
| Multiple accounts (dev, prod, S10/Mail) | Separate keys per account to create, store and rotate | One login portal lists every account; pick account + permission level |
| Claude Code | Reads the key file | Run `aws sso login --profile s10-dev` once per session; Claude Code uses the temporary credentials |
| Permission levels | Whatever the IAM user has, always | Choose per session, e.g. `Developer` in dev, `ReadOnly` in prod |
| Cost | Free | Free |

**Decision:** use Identity Center. Enable it once in the organization's management account, create one user for you (with MFA), and assign permission sets: `Admin` (break-glass, all accounts), `Developer` (dev account), `ReadOnly` (prod). Production changes go through GitHub Actions with owner approval. If S10/Mail currently uses access keys on your PC, keep them working for now and plan a later switch — S10/Marketing never uses them.
