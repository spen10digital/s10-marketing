# ADR 0011: cdk-nag v3 through CDK Validations, plus project guardrails

- **Status:** Accepted
- **Date:** 2026-11-01

## Decision
Run the cdk-nag `AwsSolutionsChecks` pack as a CDK policy-validation plugin (`Validations.of(app).addPlugins(...)`), so any unacknowledged finding fails synthesis. Acknowledgments use `Validations.of(construct).acknowledge({ id, reason })`, naming the exact finding for granular rules (e.g. a specific `AwsSolutions-IAM5[Resource::…]`). A project `Guardrails` aspect also fails synthesis for NAT gateways, RDS Proxy and log groups without retention.

## Why
cdk-nag 3 replaced `NagSuppressions` with CDK's native validation API. Synth-time failures keep CLAUDE.md's cost and security rules enforced in CI rather than by review alone.

## Consequences
Every acknowledgment needs a written reason, and each wildcard needs its own acknowledgment. Current acknowledgments: media bucket access logs (S1, deferred to CloudTrail data events in M3.2), the two DLQs (SQS3), the ops-alerts topic SSE (SNS2), and the web compute role's Parameter Store path (IAM5).
