# ADR 0014: Cognito sessions with our own code + PKCE flow; users created at first sign-in

- **Status:** Accepted
- **Date:** 2026-11-03
- **Milestone:** M1.2

## Decision
1. The web app talks to Cognito managed login directly: OAuth 2.0 authorization code + PKCE, public app client (no secret), small route handlers (`/api/auth/{login,callback,refresh,logout}`) and `aws-jwt-verify`. It does **not** use `@aws-amplify/adapter-nextjs` (02 §3.3 suggested it).
2. Tokens live in HTTP-only cookies. Every server request verifies the access token (signature, issuer, client, `token_use`, expiry) and maps `sub` to a user through `user_identities`. When the access token (60 min) expires, pages redirect through `/api/auth/refresh`, because server components cannot set cookies.
3. The `users` row is created when someone first signs in (the callback verifies the ID token and `email_verified`, then calls `app.register_user`). There is **no Cognito Post Confirmation Lambda** (the roadmap listed one).
4. Self sign-up is on. A new account sees nothing until it creates an organization (becoming its owner) or is added to one. No organizations or brands are seeded.

## Why
- The flow is about 200 lines we fully control, with no browser-side Amplify configuration and no dependency on Amplify's Next.js 16 support.
- Cognito waits at most 5 s for a trigger Lambda, but a paused Aurora cluster takes about 15 s or more to resume, so a Post Confirmation trigger would fail sign-ups after idle periods. Registering at the callback has up to 60 s and retries `DatabaseResumingException`, and it also covers users created by an admin (which don't fire the trigger).
- The owner wants to try the real onboarding as a normal user (no seed data).

## Consequences
- Only exact callback URLs work (Cognito has no wildcards). Dev registers `http://localhost:3000` and the `develop` branch alias. Per-commit preview URLs can't complete sign-in.
- Sign-out is POST-only, revokes the refresh token and ends the managed-login session.
- When S10/Suite arrives, other products become app clients of the same pool (ADR 0007); this code only changes its issuer and client configuration.
- Any signed-in user can create organizations. Before public sign-up (Phase 4), entitlements must cap orgs and AI usage per account.
