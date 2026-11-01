# ADR 0004: Social tokens encrypted with KMS

- **Status:** Accepted
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
Tokens are encrypted with a customer managed KMS key using encryption context `{org_id, connection_id}`. The web role may only Encrypt; only the worker role may Decrypt. Key rotation is on.

## Why
A leaked database row or misplaced ciphertext cannot be decrypted outside its tenant, and the internet-facing tier cannot read tokens.

## Consequences
$1/month per key plus request costs; re-encryption procedure documented in M3.2.
