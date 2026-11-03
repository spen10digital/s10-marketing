# ADR 0013: Workload region us-east-2

- **Status:** Accepted
- **Date:** 2026-11-03
- **Revises:** decision D3 (us-east-1)

## Context
CDK bootstrap in the new `s10-marketing-dev` account failed: a service control policy attached to the organization root denies regional services (CloudFormation, S3, SQS, Lambda, RDS, Cognito, SES, …) in us-east-1 and us-west-2, allows only global services in us-east-1 (IAM, STS, KMS, ACM, Logs, Budgets, Cost Explorer, Route 53, CloudFront, Organizations/SSO), and leaves **us-east-2** unrestricted. Bedrock model invocation is allowed in every region.

## Decision
Run all S10/Marketing workloads in **us-east-2 (Ohio)** and leave the organization's SCP unchanged. Vercel functions move to `cle1` (Cleveland). Global pieces keep working as the SCP intends: IAM/OIDC roles, Budgets and Cost Anomaly Detection (us-east-1 endpoints), and an ACM certificate in us-east-1 if Cognito managed login gets a custom domain.

## Consequences
- `AWS_REGION` is `us-east-2` everywhere (config schema, web server, CDK, CI). The config loader rejects any other region.
- Bedrock model access is enabled in us-east-2; `us.` inference profiles route across US regions. An SCP that blocks those destination regions also blocks the call, so M1.3 checks this on dev and may need a narrow Bedrock-only SCP exception (`docs/runbooks/m1.3-ai-studio.md` step 2).
- SES for S10/Marketing is verified in us-east-2; S10/Mail's SES (in its own account) is unaffected.
- Moving regions later would mean redeploying stacks and migrating data, so this should stay stable.
