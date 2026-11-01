# ADR 0007: Cognito "S10 Identity" pool from day one

- **Status:** Accepted
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
A Cognito user pool named for S10 Identity (`s10-identity`), with S10/Marketing as its first app client. Other S10 products become app clients later. LimitKeep is never an app client.

## Why
Gives S10/Suite single sign-on later without migrating users (02 §3.4).

## Consequences
The pool lives in this project's account until a shared identity account exists.
