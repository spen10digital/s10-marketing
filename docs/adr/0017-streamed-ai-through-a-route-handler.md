# ADR 0017: Streamed AI output through one route handler

- **Status:** Accepted
- **Date:** 2026-11-03
- **Milestone:** M1.3

## Decision
- The Studio and the Brand Voice assistant call `POST /api/ai/stream` (Node.js runtime, `maxDuration` 120 s) instead of server actions. The body names a brand and one validated request (`studioRequest`). The response is NDJSON: `start`, then `delta` events with raw model text, then `done` with the validated output, or `error` with a user-safe message.
- Bedrock is called with **ConverseStream** and Claude **structured outputs** (`outputConfig.textFormat` with a JSON schema generated from the zod output schema; unsupported constraints such as `maxLength` are stripped and enforced by zod afterwards).
- The browser shows drafts as they stream with a tolerant partial-JSON parser (`parsePartialJson`), display only. The server parses the full text strictly and validates it with zod before anything can be saved.
- The route accepts only same-origin `application/json` requests and takes the organization from the session, never from the request. Closing the tab aborts the Bedrock call.

## Why
Server actions return one value, so they can't stream. One route keeps auth, CSRF checks and error mapping in a single place. Structured outputs give valid JSON without a repair loop, and streaming JSON keeps the UI responsive for 10–30 s generations.

## Consequences
- Every new AI feature adds a case to `studioRequest`/`runStudioAction` rather than a new endpoint.
- Saving drafts stays a server action, since it doesn't stream.
