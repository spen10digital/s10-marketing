# S10/Suite integration (Suite Phase 3), progress and go-live

**Status (updated Nov 23, 2026: deployed, see the last section):** built locally on branch `suite-integration` (cut from `m1.3-ai-studio`), November 22, 2026. Nothing pushed, deployed or migrated against AWS. Plan: `S10Suite/docs/phases/planned-apps-plan.md` (Track B).

Labels: **Decided** = the owner said it (with date and where). **Proposed** = the builder's own choice, needs the owner. **Open** = a question.

## Owner decisions this work follows (Decided Nov 22, 2026, in chat)

- Base branch is `m1.3-ai-studio`. Organization = Suite account, brand = Suite business. Only `marketing.seats` as a Suite limit key.
- **Owner-only for now:** no billing, plan tiers, plan limits or customer sign-up flows are built. Nothing locks customers out: every entitlement check goes through `checkEntitlement()`, which asks the Suite, so plans and limits can be added later without changing the app.
- **Nothing of the owner is coded into the app, and the owner adds workspaces and businesses exactly as any customer would.** No organization, brand or id is hardcoded, seeded, tested or committed. A new Suite account gets its Marketing organization, and a new Suite business its brand, created automatically on first use (the same flow for every account). The owner is just a comped account with every feature and no limits. Tests use throwaway ids (`ACCT_*`, `BIZ_*`).

## What was built

| Milestone | Commit | What |
| --- | --- | --- |
| B1 Sign-in through the Suite | `82eabd7` | PKCE + nonce sign-in on the Suite's Cognito pool with this app's own client. Own sealed (`jose`, `dir`+`A256GCM`), HTTP-only, host-only session and refresh cookies (`__Host-` prefix on HTTPS). Existing users link by **verified** email (`email_verified === true`) through `user_identities(issuer, subject)`; otherwise created. Organizations are Suite accounts: created on first use for any account by `app.sync_suite_orgs` (migration `0003`), roles taken from the Suite on every sync, a membership removed when the Suite stops listing the account. |
| B2 Entitlements | `48fc18c` | `checkEntitlement()` asks `GET /api/v1/entitlements` first (60 s cache, 5 s timeout, fail closed, the template's `decide()`: `needs-business`, `no-seat`, `null` = unlimited), then applies the existing `org_entitlements` overrides unchanged. `requireOrgActor()` and the AI stream route run it. |
| B3 Business and Brand Kit seam | `bc1d6a5` | `app.sync_suite_brands` (migration `0004`) creates a brand for each Suite business where Marketing is on. `getCurrentBusiness()` reads the Suite business profile (name, website, contact, address); Marketing keeps its own voice data. Brands the Suite does not list for the person are hidden. Optional link script (below). |
| B4 Shared UI | `7864b6b` | `@spen10digital/s10-ui` 0.2.3: `AppShell`, `AppRail`, `AppSidebar` (S10 logo via `appName="S10/Marketing"`), `PageHeader`/`PageBody`, the `TopBar` from `@spen10digital/s10-ui/client` with search over Marketing's own pages and brands only, theme and light/dark following the Suite. Semantic `--s10-*` tokens only. |

## Design choices (all **Proposed**, none Decided)

1. **Mapping by columns, not by changing keys.** Local uuid keys stay. `organizations.suite_account_id` and `brands.suite_business_id` (text, unique where set) carry the Suite ULIDs. This avoids rewriting every foreign key and the Data API uuid binding. The mapping is still one to one.
2. **Memberships are written from the Suite's answer.** `app.sync_suite_orgs(jsonb)` is a `SECURITY DEFINER` function that acts only for the current user (`app.user_id`) and is called only with a real `/api/v1/me` answer (same trust as `app.register_user`). `organization_members` stays read-only for `app_rw`. Suite roles map `member` to `editor` (existing `suiteRoleToMarketingRole`).
3. **Access removed in the Suite removes the membership** here within 5 minutes (sync reuse window) to 60 seconds (`/me` cache). Brands and data are never deleted.
4. **The Suite owns the business name; Marketing owns voice, description, time zone.** The brand name is kept in step by the sync and the form shows it read-only. Manual brand creation (page and action) is removed: brands come from Suite businesses. `createBrand` stays in the domain layer and its tests.
5. **Brand visibility** is app-level (RLS stays per organization): a brand is shown only if its `suite_business_id` is in the person's `/me` businesses where Marketing is on. A brand with no Suite link (for example a pre-Suite row) is hidden, fail closed. Actions that name a brand by id (`requireBrandById`) and the AI stream route check this and the per-business entitlement, because the id comes from the client.
6. **Old sign-in path replaced, not kept behind a flag.** The `s10-identity` pool and its CDK Identity stack still exist in the repo and in dev; the app no longer uses them. Removing the stack is a separate owner decision.
7. **`SUITE_SESSION_SECRET` is an environment variable, not Parameter Store.** This departs from "Vercel env vars hold only non-secret values" in `CLAUDE.md`. The alternative is Secrets Manager plus a CDK change (new secret, role permission). Needs the owner's choice before go-live.
8. **Entitlement checks for AI budget and daily calls stay in the AI gateway** (`getAiLimits` reads `org_entitlements`, unchanged). `checkEntitlement()` supports those keys, but the gateway was not rewired to call it.
9. **CI and Vercel install:** pnpm 10 ignores an auth token in a project `.npmrc`, so `ci.yml`, `deploy-infra.yml` and `apps/web/vercel.json` run `pnpm config set "//npm.pkg.github.com/:_authToken" "$NPM_TOKEN" --location=user` before installing the private `@spen10digital/s10-ui`. Needs `NPM_TOKEN` (classic token, `read:packages`) as a repo secret and as a Vercel env var.
10. **Sidebar** lists only the live pages (Dashboard, Studio). The disabled "Queue / Media / Calendar" placeholders are gone because the kit's nav items cannot be disabled; they return with their milestones.
11. **Dev port 3010.** `pnpm dev` and `APP_URL` default to `http://localhost:3010`.

## Tenancy mapping and the optional link script

Nothing needs a backfill: a new account's organization and brands appear on first sign-in. For older rows made before Suite sign-in, whoever wants to link them can run, against a local or otherwise chosen database:

```powershell
pnpm db:link-suite-ids --mapping <file.json>           # dry run, the default
pnpm db:link-suite-ids --mapping <file.json> --apply   # write
```

It connects with `DATABASE_ADMIN_URL` (local Docker default). It is not wired to Aurora or AWS configuration, and nothing here was run against AWS. It only fills empty links, refuses conflicts, derives no keys (the ids come from the file, so no `created_at` or run time is involved), and prints labels only.

The mapping file is **never committed**. Format (every value is the person's own data):

```json
{
  "organizations": [{ "org": "<local organization uuid or slug>", "suiteAccountId": "<Suite account id>" }],
  "brands": [{ "brand": "<local brand uuid or organization-slug/brand-slug>", "suiteBusinessId": "<Suite business id>" }]
}
```

A brand can only be linked after its organization is linked (in the same file or earlier). After linking, the first sign-in of a member syncs roles; legacy memberships are not removed until then.

## Tests

Counts after B4 (local, `pnpm`): typecheck, lint, format:check clean; **186 unit tests** (baseline 141); **62 database tests** against Postgres 16 (baseline 44); `infra:synth` ok; Playwright smoke 6 passed, 1 skipped by design (needs a deployed dev Suite sign-in). `pnpm --filter @s10/web build` ok.

Fail-closed coverage (builder rule 3): the Suite client throws on network error, timeout, 5xx, malformed or non-JSON bodies and caches nothing; `createOrgResolver` never calls the sync when the Suite is unreachable or refuses; `checkEntitlement` allows nothing and never touches the database for any key; `getCurrentBusiness` falls back, flags `unavailable` and writes nothing (row counts checked). A throwaway Suite stand-in and the running app were also exercised by hand: with the stand-in down, `/dashboard` redirected to `/no-access` and `/api/ai/stream` answered 503.

### Not tested (builder rule 7)

- **A real sign-in.** No Marketing client exists in the Suite's Cognito yet, so the Cognito token exchange, ID token verification against the Suite pool, `email_verified` handling and logout were not run end to end. The pieces are unit tested (PKCE, nonce, sealing, secret decoding) but the routes `/api/auth/login|callback|refresh|logout` have no test of their own.
- **The refresh route and `proxy.ts`** (preferences refresh) against real Cognito or the real Suite. Only a local stand-in was used.
- **Visual check in a browser.** The Browser pane refused `localhost`, so the shell, rail, sidebar, top bar and themes were checked as served HTML (structure, search groups, brand names from the Suite) and not by eye. Light/dark, the four themes, mobile layout and contrast are unchecked.
- **Saving the theme** (`savePreferencesAction` and the top bar's `onPreferencesChange`) and the cookie round trip in a browser.
- **The RDS Data API.** The sync functions are tested on Postgres through `pg` only; passing `jsonb` and `uuid` parameters through the Data API driver (`${json}::jsonb`) is not tested.
- **Concurrency across function instances** beyond the two-request race tests on one database.
- **Multiple accounts in the switcher**, per-business enablement (`per_business_apps`) against a real Suite, Viewer and seat behaviour against a real Suite (covered only by the pure `decide()` tests).
- **`vercel.json`, `ci.yml` and `deploy-infra.yml` changes** for the private package token. They were not run.
- **Workers and background calls.** No worker reads Suite entitlements yet, so no Vercel OIDC (`@vercel/oidc`) path exists in this app. When the first worker needs one, it needs its own fail-closed test.
- **The e2e signed-in flow** (still skipped without a deployed dev Suite and a throwaway test user).

## Go-live steps still needed (none done; each is the reviewer's or owner's)

1. **Suite: a Cognito app client for Marketing** (public client, authorization code + PKCE, callbacks `http://localhost:3010/api/auth/callback`, the dev and prod URLs, and sign-out URLs `.../signed-out`), created by the reviewer through the Suite's CDK (`cdk diff` first, owner OK before deploy). Gives `COGNITO_CLIENT_ID`; the pool id and domain come from the Suite stack (`login.spen10.com` in prod).
2. **Suite: registry entry** for `marketing` (status `planned` until verified, `beta` after), its `marketing.seats` limit key, and Cognito client id, as data (no Suite code change).
3. **Vercel project `s10-marketing`:** env vars (all environments): `NPM_TOKEN`, `APP_ENV`, `AWS_ROLE_ARN`, `SUITE_URL`, `S10_APP_ID=marketing`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`, `SUITE_SESSION_SECRET` (a different random 32-byte base64url value per environment, sensitive). Vercel env vars override the Parameter Store `cognito-*` values written by the old Identity stack, so those SSM values may stay or be removed later. Also add the Vercel OIDC trust of the Suite registry (`vercelProject`) when a worker needs it.
4. **DNS and domain:** `marketing.spen10.com`: add it to the Vercel project, then the CNAME in Cloudflare to the value Vercel shows. `APP_URL` (SSM `app-url`) must be that URL for the callback and cookies.
5. **GitHub:** repo secret `NPM_TOKEN`; decide whether CI keeps `format:check` and the Playwright smoke test (it now needs only throwaway env values, set in `playwright.config.ts`).
6. **Aurora migrations `0003_suite_link` and `0004_suite_brands`** against dev, then prod (`pnpm db:migrate --aws --env dev`), after the owner's OK. Both are additive (two nullable columns, two unique partial indexes, two functions, two narrow policies). Rollback: drop the two functions, indexes, columns and policies; no data is rewritten.
7. **Decide `SUITE_SESSION_SECRET` storage** (design choice 7) and the future of the `s10-identity` Identity stack (design choice 6).
8. **Plans and limits** are not built (owner-only for now). When they are: add `marketing` tiers and the `marketing.seats` values in the Suite's plans; the app needs no change.
9. **First real check as the owner:** sign in once on the Suite, open Marketing from the rail, confirm no second login, the right account and businesses, and that a new business created in the Suite appears as a brand without any action here.

## Open

- Whether `checkEntitlement()` should also gate the AI gateway's own budget checks (design choice 8).
- Whether people removed from a business in the Suite should have their brand archived here (today it is only hidden).
- Whether Marketing's Brand Kit reads (logos, colors, voice) arrive through a Suite Brand Kit API: the Suite has only the business profile today, so `getCurrentBusiness()` reads that.

## Deployed Nov 23, 2026 (owner OK in chat at each step)

- Next.js 16.4.3 to 16.4.6 (commit `de2b6c1`); 186 unit tests, typecheck, lint and the web build pass.
- Migrations 0002 to 0004 applied to **dev** Aurora; 0001 to 0004 applied to the new **prod** Aurora. `SUITE_SESSION_SECRET` is a sensitive Vercel env var (owner chose this over Secrets Manager; it departs from the "no secrets in Vercel env vars" rule in `CLAUDE.md`).
- Prod AWS (`s10-marketing-prod`, account `290303514558`) stood up: CDK bootstrap, then Core, Database, VercelAccess and Observability. Cicd and Identity not deployed. No alert email is subscribed yet.
- Vercel: Production env vars set, `marketing.spen10.com` attached, project function region set to `cle1` (a deploy from the repo root had ignored `regions` in `apps/web/vercel.json` and ran in `iad1`, which failed the `AWS_REGION` check). Deployed with `vercel deploy --prod` from this worktree. The branch is pushed but **not merged**; `main` is still at M1.1 (open: via `develop` or straight to `main`).
- Suite registry: `marketing` set to `beta`. Signed in as the owner: the dashboard opened with no second sign-in and listed five brands built from the five Suite businesses.
- **Not tested:** logout and refresh routes against the real Suite, theme saving, the desktop layout, the brand card details (they show "No description"), and a Preview deploy (the dev Cognito client allows localhost only). No workspace switcher yet.
