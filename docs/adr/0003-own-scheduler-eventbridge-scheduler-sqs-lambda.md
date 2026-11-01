# ADR 0003: Own scheduler: EventBridge Scheduler + SQS + Lambda

- **Status:** Accepted
- **Date:** 2026-10-29
- **Source:** docs/02-technical-architecture.md §15

## Decision
Per-post one-time EventBridge schedules put a message on SQS; a Lambda worker publishes. The database is the source of truth; a sweeper Lambda catches anything missed. Meta native scheduling is not primary.

## Why
Uniform behaviour across platforms, approval gating up to the last moment, idempotency and reconciliation under our control (02 §6).

## Consequences
More moving parts than calling Meta's scheduler; needs DLQ alarms and a heartbeat.
