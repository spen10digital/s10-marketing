# ADR 0005: Facebook Login for Business only to connect Pages

- **Status:** Accepted
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
Facebook Login for Business (configuration-based) is used solely to obtain Page access; users sign in with Cognito.

## Why
Keeps identity in S10 Identity and limits Meta permissions to publishing needs (03).

## Consequences
Two login concepts in the UI; mitigated with clear "Connect Page" wording.
