# ADR 0006: AI through Bedrock Converse behind an `AiGateway`

- **Status:** Accepted
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
All AI calls go through a task-based `AiGateway` with a Bedrock Converse provider (Claude via `us.` inference profiles). Model IDs live in Parameter Store. The model has no tools that act.

## Why
IAM auth and AWS billing, one interface across models, easy model swaps and per-org budgets/metering.

## Consequences
Bedrock model access and quotas must be requested per account.
