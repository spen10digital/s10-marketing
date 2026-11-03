# 06 — Cost & Launch Plan (AWS-first)

**Prices checked:** 2026-10-28/29 on AWS and vendor pricing pages (links at the end). USD, before tax. The app runs in **us-east-2 (Ohio)**; its list prices match us-east-1 for the services used here *(verify)*. *(verify)* = not confirmed on an official page in this pass. Usage numbers are planning assumptions — replace them with real `usage_events` and Cost Explorer data after Phase 2.

---

## 1. Unit prices used

| Service | Price | Free allowance |
|---|---|---|
| **Vercel Pro** (web hosting, ADR 0012) | $20 per member per month; usage beyond included allowances billed per use *(verify on vercel.com/pricing)* | Pro includes allowances that cover an internal tool |
| **Aurora Serverless v2** (Standard) | $0.12 per ACU-hour · storage $0.10/GB-mo · I/O $0.20 per 1M | **0 ACU when paused** (pays storage only); backup storage free up to cluster size |
| **RDS Data API** | $0.35 per 1M requests | 1M requests/month for the first year |
| **Cognito** (Lite/Essentials) | Essentials $0.015/MAU above free tier | 10,000 MAU/month free |
| **EventBridge Scheduler** | $1 per 1M invocations | 14M invocations/month |
| **Lambda** | $0.20 per 1M requests + duration | 1M requests and 400,000 GB-seconds/month |
| **SQS** | per-request pricing | 1M requests/month *(verify current terms)* |
| **SES** (Essentials plan, default for new usage) | $0.16 per 1,000 emails | — (à la carte plan: $0.10/1,000) |
| **KMS** | $1 per key-month (+$1 for each of the first two rotations) · ~$0.03 per 10k requests | 20,000 requests/month |
| **Secrets Manager** | $0.40 per secret-month · $0.05 per 10k calls | — |
| **S3 / CloudWatch / SNS** | standard rates *(verify)*; small at internal scale | partial free tiers |
| **Amazon Bedrock – Claude Sonnet 5.5 (generation) / Haiku 5.5 (quick edits)** — chosen for price/performance | Bedrock's table didn't render; Anthropic models on Bedrock have typically matched Anthropic's list prices: **$2 / $10** (Sonnet 5.5) and **$0.10 / $0.50** (Haiku 5.5) per 1M input/output tokens — *(verify on the Bedrock pricing page)* | — |
| **Bedrock image model** (Nova Canvas or newer) | ≈ $0.04–0.08 per image *(verify; secondary sources)* | — |
| **AWS WAF on Amplify** (Phase 4) | $15/month per Amplify app + WAF rule/request charges | — |
| **Stripe** | 2.9% + 30¢ per card charge; Billing 0.7% | — |
| **Meta APIs, App Review, business verification** | $0 | — |

New AWS accounts can receive up to $200 in Free Tier credits; whether your existing account qualifies depends on its age — new Organization member accounts may not count as "new customers" *(verify)*.

### AI cost per action (Bedrock, assuming price parity)

| Action | Tier | Tokens in / out | Cost |
|---|---|---|---|
| 3 post variants | Sonnet | ~5,000 / ~900 | ≈ $0.02 |
| Rewrite (shorten/expand/tone/adapt) | Haiku | ~1,500 / ~300 | ≈ $0.0003 |
| Article summary | Haiku | ~6,000 / ~400 | ≈ $0.0008 |
| Campaign concepts | Sonnet | ~6,000 / ~2,500 | ≈ $0.04 |

Prompt caching of the brand context lowers this further. Bedrock's model card lists Batch as unsupported for Sonnet 5.5, so batch discounts aren't assumed.

---

## 2. Scenario A — Personal / internal (4 brands)

Assumptions: ~120 posts/month, ~300 generations, a few hours of interactive use per day, Aurora auto-pause after 5 minutes idle and a 15-minute sweeper → database active ~30–60% of the month at ~0.5 ACU.

| Category | Monthly |
|---|---|
| Fixed-ish — Aurora Serverless v2 compute (0.5 ACU × 30–100% of hours) | ≈ $13–44 |
| Fixed-ish — Aurora storage + I/O | ≈ $1–2 |
| Fixed — KMS key ($1) + Secrets Manager (3 secrets, $1.20) | ≈ $2–3 |
| Fixed — Vercel Pro (1 member) | ≈ $20 |
| Usage — Lambda, SQS, EventBridge Scheduler, Data API, Cognito | ≈ $0 (free tiers) |
| Usage — CloudWatch logs/alarms, S3, SNS, SES | ≈ $1–5 *(verify)* |
| Variable AI — Bedrock text | ≈ $6–10 |
| External — Meta | $0 |
| **Total** | **≈ $45–85/mo** (≈ $45–55 typical with auto-pause) |

Comparable to the previous Supabase/Vercel estimate ($35–55); the AWS version is cheaper when idle and includes point-in-time restore, which Supabase charged $100/mo for.

## 3. Scenario B — Small customer base (≈25 paying orgs)

Assumptions: 2 brands/org, 60 posts and 150 generations per org/month; customers active during the day → set **min capacity 0.5 ACU** (no cold starts) → ~0.5–1 ACU average; ~$975 MRR at $39 ARPU.

| Category | Monthly |
|---|---|
| Aurora compute (0.5–1 ACU always on) + storage/I/O | ≈ $46–95 |
| Vercel Pro (1–2 members) + usage | ≈ $20–60 |
| Lambda/SQS/Scheduler/Data API/Cognito (mostly free tier) | ≈ $2–10 |
| CloudWatch, S3, SES, KMS, Secrets Manager | ≈ $10–25 |
| Vercel Firewall rules (public signup; usage-based extras) | ≈ $0–20 |
| Bedrock text (25 × 150 × $0.02 + rewrites) | ≈ $85 |
| Bedrock images (optional, ~750 images) | ≈ $30–60 |
| Stripe fees | ≈ $45 |
| **Total** | **≈ $245–400/mo** vs ≈ $975 MRR |

One-off: legal review of Terms/Privacy/DPA *(assumption: $500–2,000)*.

## 4. Scenario C — Growing SaaS (≈500 paying orgs)

Assumptions: 200 generations + 40 images per org/month; Aurora writer averaging 2–4 ACU plus one serverless reader for failover; ~$19.5k MRR.

| Category | Monthly |
|---|---|
| Aurora (writer + reader, 2–4 ACU avg each) + storage/I/O (consider I/O-Optimized) | ≈ $400–800 |
| Vercel Pro + usage | ≈ $100–300 |
| Lambda/SQS/Scheduler/Data API | ≈ $20–60 |
| Cognito (≈1,000 MAU — still within free tier) | ≈ $0 |
| CloudWatch, X-Ray, S3, SES, KMS, Secrets, Backup | ≈ $60–150 |
| WAF | ≈ $30–60 |
| Bedrock text | ≈ $2,000–2,500 |
| Bedrock images | ≈ $800–1,600 |
| Stripe fees | ≈ $850 |
| Support tooling / status page *(verify)* | ≈ $50–200 |
| **Total** | **≈ $4,300–6,400/mo** vs ≈ $19.5k MRR (≈ 67–78% gross margin) |

AI remains the dominant variable cost, so plans must meter generations and images. At this scale ask AWS about Bedrock Reserved/Priority tiers and Savings Plans.

---

## 5. Pricing hypotheses (validate in beta)

| Plan | Price | Draft limits | Worst-case AI cost |
|---|---|---|---|
| Starter | $19/mo | 1 brand, 2 Pages, 100 generations, no automation | ≈ $2 |
| Pro | $49/mo | 3 brands, 6 Pages, 400 generations, RSS automation, 50 images | ≈ $10–12 |
| Agency | $129/mo | 10 brands, 25 Pages, 1,500 generations, 200 images, team seats | ≈ $38–46 |

Competitor pricing not yet researched (do it in M4.2). Trial: 14 days with a generation cap.

---

## 6. Development costs

| Item | Cost |
|---|---|
| Claude Code | existing Claude subscription |
| Dev AWS account | ≈ $15–40/mo (Aurora auto-pause, Bedrock dev usage); budget alert at $25 |
| Meta developer account, verification, review | $0 |
| Time (part-time, rough) | Phase 0–1: ~6–8 weeks (AWS/CDK setup adds ~1 week vs the Supabase plan) · Phase 2: ~3–5 · Phase 3: ~2–4 (+ 2–4 weeks unattended) · Phase 4: ~5–8 (+ Meta review lead time) |

---

## 7. Spend guardrails (Phase 1)

1. **AWS Budgets** per account (alerts at $25 / $75 / $150) and **Cost Anomaly Detection** with email alerts; a **Vercel spend limit** with notifications on the Pro team.
2. CloudWatch alarm on Bedrock token usage/day; in-app per-org AI budget and caps.
3. CDK + `cdk-nag` rules that fail the build if a NAT Gateway, RDS Proxy, provisioned Aurora instance or log group without retention is added.
4. Aurora max capacity capped (start at 4 ACU) to bound worst-case compute.
5. SES configuration set with bounce/complaint monitoring (protects the S10 sending domain).
6. Ads: never created or launched without explicit per-action approval.

---

## 8. Launch plan

| Stage | Exit criteria |
|---|---|
| Internal alpha (Phases 1–3) | 4 brands publishing on schedule for 2–4 weeks; zero duplicate/lost posts; alarms fire within 15 min of failures; AWS bill matches Scenario A |
| Meta readiness (M4.3) | Business verification, Tech Provider verification, Advanced Access approved |
| Private beta (10–20 design partners from SPEN10 and S10/Mail audiences) | Median onboarding → first post < 15 min; Aurora min capacity raised to 0.5 ACU; SES out of sandbox; WAF on |
| Public launch | Billing live, deletion/export working, legal docs reviewed, runbooks and restore drill done |

Launch channels: SPEN10 tutorial content, S10/Mail newsletter, build-in-public posts published with the product itself, Product Hunt / Show HN once stable.

**Go/no-go:** RLS tests 100% · `cdk-nag` clean · restore drill this quarter · SNS alerts to phone · kill switch tested · Meta permissions approved · Stripe live tested · privacy policy and data-deletion URL live · rate limits/WAF active.

---

## 9. Sources

- Vercel pricing: https://vercel.com/pricing · Vercel OIDC with AWS: https://vercel.com/docs/oidc/aws
- Aurora pricing: https://aws.amazon.com/rds/aurora/pricing/ · Scale to zero: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html · Data API limitations: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.limitations.html
- Cognito pricing: https://aws.amazon.com/cognito/pricing/
- Bedrock pricing: https://aws.amazon.com/bedrock/pricing/ · Claude Sonnet 5.5 on Bedrock: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html
- Anthropic list prices (parity assumption): https://platform.claude.com/docs/en/about-claude/pricing
- EventBridge pricing: https://aws.amazon.com/eventbridge/pricing/ · Lambda pricing: https://aws.amazon.com/lambda/pricing/
- SES pricing: https://aws.amazon.com/ses/pricing/ · KMS pricing: https://aws.amazon.com/kms/pricing/ · Secrets Manager pricing: https://aws.amazon.com/secrets-manager/pricing/
- Stripe Billing pricing: https://stripe.com/billing/pricing
