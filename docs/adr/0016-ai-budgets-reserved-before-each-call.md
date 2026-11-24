# ADR 0016: AI budgets are reserved before each call

- **Status:** Accepted
- **Date:** 2026-11-03
- **Milestone:** M1.3

## Decision
- Every model call goes through `AiGateway`. It first runs `reserveGeneration` in its own transaction:
  - takes a per-org advisory lock (`pg_advisory_xact_lock`);
  - checks the daily call cap (default 100 per org per UTC day);
  - checks the monthly budget (default `AI_DEFAULT_MONTHLY_BUDGET_USD` = $10 per org, per UTC month);
  - inserts an `ai_generations` row with status `pending` and `reserved_micros`, the worst case for the call: every prompt token written to the cache plus the full `max_tokens` of output.
- The model call runs **outside** any transaction. Afterwards a second transaction records the real tokens and cost, sets the final status (`succeeded`, `failed`, `invalid_output`) and appends a `usage_events` row.
- Monthly spend = finished calls at their real cost + pending calls at their reservation. A call that fails before producing output costs 0; a call that fails after output without a usage report keeps its reservation.
- Website reads (Brand Voice assistant, Studio articles) are counted as `usage_events(kind = 'web_fetch')` under the same lock, before anything is fetched (default 20 per org per day).
- Per-org overrides live in `org_entitlements`, which the app can read but never write (set by migrations now, billing in Phase 4).
- Prices are a table in code (`packages/core/src/ai/pricing.ts`). A model without a price is refused, so spend can't go unmetered.

## Why
Checking a sum and then calling the model races: two parallel requests can both pass the check. The lock plus the reservation makes the budget hold under concurrency (DB test: 6 parallel reservations of $0.003 against a $0.01 budget → exactly 3 succeed). Keeping the slow model call outside the transaction avoids holding Data API transactions open while Claude writes.

## Consequences
- The budget is conservative: a crash between the call and the finish leaves the reservation counted.
- Concurrent requests from one org serialize only for the few milliseconds of the reservation.
- The prices must be updated by hand when Bedrock changes its rates or a model is swapped.
