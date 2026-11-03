# ADR 0009: AWS-first platform

- **Status:** Accepted; web hosting part superseded by ADR 0012 (Vercel); region set by ADR 0013 (us-east-2)
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
Amplify Hosting (Next.js 15), Aurora Serverless v2 + Data API, Cognito, EventBridge/SQS/Lambda, Bedrock, S3, SES, KMS, Secrets Manager/Parameter Store, CloudWatch/SNS, CDK. Non-AWS only for GitHub, Stripe and Meta.

## Why
Owner preference: one bill, IAM everywhere, no third-party platform sprawl.

## Consequences
Next.js pinned to 15 (Amplify limits: no streaming, no edge runtime).
