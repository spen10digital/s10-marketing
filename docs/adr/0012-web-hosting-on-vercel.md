# ADR 0012: Web hosting on Vercel

- **Status:** Accepted
- **Date:** 2026-11-01
- **Supersedes:** the Amplify Hosting part of ADR 0009

## Decision
The Next.js web app is hosted on **Vercel (Pro plan)** with the latest Next.js (16) and React (19.3). Everything else stays on AWS as planned: Aurora + Data API, Cognito, EventBridge/SQS/Lambda workers, Bedrock, S3, SES, KMS, Secrets Manager/Parameter Store, CloudWatch, CDK.

- **AWS access:** Vercel OIDC federation (issuer mode *Team*, `https://oidc.vercel.com/<team>`) → IAM role `s10-marketing-<env>-web-runtime` (`infra/lib/vercel-access-stack.ts`). The dev account trusts Vercel `preview` and `development`; the prod account trusts `production` only. Server code uses `awsCredentialsProvider` from `@vercel/functions/oidc` with `AWS_ROLE_ARN`. No access keys.
- **Region:** functions pinned to `cle1` (next to us-east-2; see ADR 0013).
- **Config:** Vercel env vars carry only non-secret values (`APP_ENV`, `AWS_ROLE_ARN`); everything else comes from Parameter Store / Secrets Manager through the role.
- **AI:** Claude Sonnet 5.5 (generation) and Claude Haiku 5.5 (quick edits) on Bedrock, chosen for price/performance; Studio output is **streamed**.
- **Not used:** Vercel Postgres/KV/Blob, AI Gateway, Cron — the AWS equivalents remain.

## Why
Owner decision: current React/Next.js and streamed AI output, which Amplify Hosting didn't support (Next.js 15 at most, no streaming).

## Consequences
- About $20/month per Vercel member (Pro is required for commercial use).
- Two vendors; the web tier sits outside the AWS account. OIDC keeps the no-keys rule intact.
- Edge protection in Phase 4 uses the Vercel Firewall instead of AWS WAF.
- Exit path: Amplify Hosting or OpenNext on Lambda/CloudFront. The AWS resources stay the same; only the web role's trust policy changes.
