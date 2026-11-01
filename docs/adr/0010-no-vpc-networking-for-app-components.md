# ADR 0010: No VPC networking for app components

- **Status:** Accepted
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
Web and Lambdas reach AWS services over IAM-authenticated HTTPS (Data API, SQS, Scheduler, Bedrock, KMS). No NAT gateways or RDS Proxy; a synth-time guardrail rejects them.

## Why
Avoids NAT costs and VPC complexity, and lets Aurora scale to zero.

## Consequences
Data API limits (1 MiB responses, explicit transactions) shape the DB layer.
