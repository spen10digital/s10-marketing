# ADR 0001: Separate repository and AWS accounts

- **Status:** Accepted
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
S10/Marketing lives in its own repository and in dedicated `s10-marketing-dev` and `s10-marketing-prod` accounts under one AWS Organization (D2).

## Why
Blast radius, billing and IAM boundaries are per product and per environment. Production changes run only from GitHub Actions with owner approval.

## Consequences
Two accounts to bootstrap and maintain; cross-account sharing (e.g. a future shared identity account) is explicit.
