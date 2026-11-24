# ADR 0018: Drafts are saved unassigned (`posts.target_id = null`)

- **Status:** Accepted
- **Date:** 2026-11-03
- **Milestone:** M1.3

## Decision
- Studio drafts are `posts` rows with `status = 'draft'` and `target_id = null`. A Page is chosen later (M1.4 connects Pages; M1.5 adds approval and publishing). The foreign key from `posts.target_id` to `social_targets` is added in migration 0003, when that table exists.
- Every save writes a `post_revisions` row (append-only). A post can link the `ai_generations` row it came from (same org and brand only).
- RLS lets editors insert only drafts and update only drafts, and only the body, link, version and content item columns. Status changes arrive with the M1.5 state machine.

## Why
Writing comes before connecting Pages in the roadmap, and one draft may later go to a different Page than first planned. A nullable target avoids a placeholder Page and keeps drafts real rows that M1.5 builds on.

## Consequences
- Publishing code must refuse posts without a target (M1.5).
- The anti-repetition context reads recent posts per brand, assigned or not.
