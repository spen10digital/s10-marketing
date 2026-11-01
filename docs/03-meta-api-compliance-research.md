# 03 — Meta API & Compliance Research

**Researched:** 2026-10-28 against Meta's official developer documentation (links in §12).
**Legend:** ✅ **Verified** — stated in current official docs · ⚠️ **Assumption / partially verified** — inferred, from secondary sources, or docs ambiguous · ❓ **Open question** — must be tested in the M0.2 spike or asked of Meta.

Meta changes these rules often. Re-verify every ✅ item before App Review submission (M4.3) and at each Graph API version upgrade.

---

## 1. API versions

| Item | Status | Detail |
|---|---|---|
| Latest Graph API / Marketing API version | ✅ | **v26.0**, released 2026-07-29 (expiry TBD). v25.0 expires 2028-07-29; v24.0 expires 2028-02-18. v20.0 expired 2026-09-24. |
| Version policy | ✅ | Each version is supported for roughly two years; unversioned calls fall back to the app's dashboard version. |
| Cross-version removals on 2026-10-27 | ⚠️ | Per Meta's v26.0 changelog (as reported): `date_format` param and root `GET /?ids=` requests now error on **all** versions; `pretty`, `debug` and `If-None-Match`/ETag behavior ignored. **Don't use these.** |

**Decision:** pin **v26.0** in config (`META_GRAPH_VERSION=v26.0`), always call versioned URLs, add a calendar reminder to evaluate upgrades every 6 months.

---

## 2. What can and cannot be published

| Destination | Status | Detail |
|---|---|---|
| **Facebook Pages** | ✅ | Supported via Pages API: `POST /{page-id}/feed` (text, link), `POST /{page-id}/photos` (image by `url`), video via Video API, Reels via Reels Publishing API. |
| **Facebook Groups** | ✅ (deprecated) | The Groups API, including `publish_to_groups`, was deprecated with Graph API v19.0 (Jan 2024) and removed for all versions in April 2024. **No API publishing to Groups.** |
| **Personal profiles** | ⚠️ | No current permission allows apps to publish to a personal timeline (`publish_actions` was removed in 2018). Treat as unsupported. Users can share manually. |
| Instagram (later) | ✅ | Requires an Instagram **professional** account; content publishing API (see §9). |

---

## 3. Facebook Page publishing details

### 3.1 Required permissions and Page tasks

| Permission | Status | Why |
|---|---|---|
| `pages_show_list` | ✅ | List Pages the user manages (dependency of the others) |
| `pages_manage_posts` | ✅ | Create, edit and delete Page posts, photos and videos. Depends on `pages_read_engagement` + `pages_show_list` |
| `pages_read_engagement` | ✅ | Read Page content/metadata — also needed to **reconcile** ambiguous publishes and to read Reels copyright status |
| `business_management` | ✅ | Default in the "Manage everything on your Page" use case; needed for Business-portfolio-owned assets with Facebook Login for Business |
| `read_insights` | ✅ | Page/post insights (Phase 3 analytics) |
| `pages_manage_engagement`, `pages_read_user_engagement` | ⚠️ | Listed in the Pages posts guide for full post management (comments). **Not needed** for publishing; omit until comment features exist (least privilege). |
| `publish_video` | ⚠️ | The posts guide mentions it for video; the permissions reference describes it as **live** video. The Video API publishing guide only requires `pages_manage_posts`. **Don't request it** unless the video spike proves it's required. |

Page tasks: ✅ the app user must be able to perform **CREATE_CONTENT** on the Page to publish (the posts guide lists CREATE_CONTENT, MANAGE and MODERATE for the full set of post operations).

### 3.2 Endpoints and capabilities

| Post type | Endpoint | Status | Notes |
|---|---|---|---|
| Text | `POST /{page-id}/feed` `message=` | ✅ | |
| Link | `POST /{page-id}/feed` `message=&link=` | ✅ | Preview is built by Meta from the URL's Open Graph tags — make sure SPEN10/LimitKeep pages have good `og:title/description/image`. ⚠️ Custom preview overrides (name/description/picture) are not supported for most apps. |
| Single photo | `POST /{page-id}/photos` `url=&caption=` (or `message`) | ✅ | Returns photo id + post id. Meta fetches the URL → use a short-lived signed URL. |
| Multi-photo | Upload each photo with `published=false`, then `POST /{page-id}/feed` with `attached_media[]` | ⚠️ | Long-standing documented pattern; verify on v26 in the media spike (M1.6). |
| Video | Resumable Upload API (`POST /{app-id}/uploads` → `POST /upload:{session}` → `POST graph-video.facebook.com/v26.0/{page-id}/videos` with the file handle) | ✅ | Upload step uses a **user** access token; publish step uses the **Page** token. |
| Reels | `POST /{page-id}/video_reels` (start) → upload to `rupload.facebook.com` (binary or `file_url`) → finish with `video_state=PUBLISHED\|SCHEDULED\|DRAFT` | ✅ | 9:16, 540×960 min (1080×1920 recommended), 3–90 s, 24–60 fps, AAC audio. **30 API-published Reels per Page per rolling 24 h.** Public audience only. Must show sharing disclosure/controls. Optional `is_ai_generated` flag. |
| Update a post | `POST /{post-id}` | ✅ | Only posts **created by the same app** can be updated. |
| Delete a post | `DELETE /{post-id}` | ✅ | |
| Read Page posts | `GET /{page-id}/feed` | ✅ | Used by the reconciler. |

### 3.3 Native scheduling

✅ `published=false` + `scheduled_publish_time` (Unix seconds, ISO 8601, or `strtotime` string). **Must be between 10 minutes and 30 days** from the request. Reels: more than 10 minutes and at most **29 days**. → The app uses its **own scheduler** (Architecture §6.2).

### 3.4 Geo-targeting (organic)

✅ `targeting.geo_locations` / `feed_targeting.geo_locations` can restrict an organic post's audience. Not needed for v1.

---

## 4. Login, tokens and reconnection

### 4.1 Login product

✅ **Facebook Login for Business** is the recommended login for business-asset access. Key facts:
- Uses a **configuration** (`config_id`) defined in the App Dashboard instead of `scope`; the configuration fixes token type, assets and permissions.
- Requires a **Business-type** Meta app owned by its own Business portfolio.
- Two token types:
  - **User access token** — tied to the person; suited to real-time actions by a present user.
  - **Business Integration System User (BISU) token** — tied to the client's Business portfolio; **does not expire by default**; meant for "programmatic, automated actions on your business clients' assets" (e.g. scheduled publishing); access limited to assets the client selects; **web only**.
- Serving businesses you don't own/manage requires **Advanced Access** via App Review.

### 4.2 Token lifetimes

| Token | Status | Lifetime |
|---|---|---|
| Short-lived user token | ✅ | ~1–2 hours; exchange server-side immediately |
| Long-lived user token | ✅ | **About 60 days**; obtained with `grant_type=fb_exchange_token` (requires app secret → server only). Cannot be refreshed once expired → user must log in again |
| Page token from a long-lived user token | ✅ | **No expiration date**, but can be invalidated "under certain conditions" (⚠️ typically: the user changes password, loses their Page role, removes the app, or Meta security events) |
| BISU token | ✅ | Never expires by default; optional 60-day expiry |

### 4.3 Reconnection strategy

1. Store Page tokens (encrypted); validate daily with `GET /debug_token`.
2. Treat error **code 190** (invalid/expired token) as `needs_reauth`: stop retries, mark target, email the owner, show a **Reconnect** button.
3. Reconnect = run the same login flow; upsert credentials; resume queued jobs (posts stay `scheduled`; jobs that failed with `needs_reauth` are re-enqueued by the sweeper).
4. The long-lived user token is kept only if needed for user-token-only calls (e.g. video resumable upload session). Track its `expires_at` and prompt reconnect ~7 days before expiry when it's needed.

❓ **Open:** Phase 4 — should customer connections use BISU tokens (stable, business-scoped) or user-derived Page tokens? BISU requires the customer to have a Business portfolio; many small creators may not. **Plan:** support user-token flow first; prototype BISU in M4.3 and choose based on customer onboarding friction.

---

## 5. Access levels, App Review and verification

| Topic | Status | Detail |
|---|---|---|
| Standard Access | ✅ | Automatically granted for Business apps for all permissions available to the app type. **Permissions with Standard Access can only be requested from users who have a role on the app** (admin/developer/tester). |
| Advanced Access | ✅ | Required to request permissions from **any** user. Approved **per permission** through **App Review**. **Business Verification is required** for Advanced Access. |
| Internal-only use | ✅ (inferred from the above) | If only people with a role on the app use it, **Standard Access is enough — no App Review, no business verification**. This covers Phases 1–3 for the owner's own Pages. |
| Post visibility while not reviewed | ❓ | Historically, content created by apps in development mode was visible only to app roles. Business apps now rely on access levels. **Must test in M0.2:** publish a test post and confirm it is visible to a logged-out visitor. |
| Tech Provider / Access Verification | ✅ | A business whose app is used by **other businesses** and requests Pages/ads/Instagram permissions must be verified as a **Tech Provider** (form under App Dashboard → Basics → Verifications → Access verification; review ~5 days). Without it, calls by users without an app role fail (error code 100). |
| App Review submission contents | ✅ | Complete app settings; reviewer instructions per platform; justify each permission (remove unused); test credentials; app icon (512–1024 px), **Privacy Policy URL**, **data deletion URL or callback**, DPO contact if doing business in the EU; app must be **published**. In practice reviewers expect a screencast showing the end-to-end flow for each permission (⚠️ common practice, check current form). |
| Business Verification | ✅ | Required for Advanced Access; done on the Business portfolio (legal name, address, phone, website/domain, documents). ⚠️ Typically takes days to weeks. **Start before Phase 4.** |
| Data use checkup | ⚠️ | Live apps must complete Meta's annual Data Use Checkup to keep permissions. Calendar it. |

### Phase 4 App Review package (prepare in M4.3)

- Permissions to request (Advanced): `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management` (if retained), `read_insights` (if analytics ships). Later: `instagram_basic`, `instagram_content_publish`; ads: `ads_read`, `ads_management`.
- Screencasts: login + Page selection; composing + publishing a post with the result visible on the Page; disconnect; data deletion.
- Public pages: privacy policy explaining Meta data use, data deletion instructions, terms of service.
- Test account and test Page for the reviewer.

---

## 6. Rate limits and usage restrictions

| Limit | Status | Detail |
|---|---|---|
| Which limit applies | ✅ | Page tokens / system-user tokens → **Business Use Case (BUC)** limits; app/user tokens → Platform limits. BUC takes precedence when both apply. |
| Pages BUC | ✅ | `Calls within 24 hours = 4800 × Number of Engaged Users` (users who engaged with the Page in 24 h). Small Pages therefore have small budgets — keep calls lean. |
| Platform limit | ✅ | `Calls within one hour = 200 × Number of Users` (app-level). |
| Headers | ✅ | `X-App-Usage`, `X-Business-Use-Case-Usage` (includes `estimated_time_to_regain_access` in minutes). |
| Rate-limit error codes | ✅ | 4 (app), 17 (user), 32 (Pages user/app), 613 (custom), 80001 (Pages BUC). **Stop calling when limited** — further calls extend the block. |
| Reels | ✅ | 30 API-published Reels per Page per rolling 24 h; collaborator invites 10/Page/24 h. |
| Duplicate posts | ⚠️ | Meta may reject identical repeated messages as spam/duplicates. App-side duplicate guard (Architecture §6.3) avoids this. |
| Platform Terms / Developer Policies | ✅ | Apply at all access levels because calls hit production data. Key implications: no selling data, honor deletion requests, don't use Meta data to train models for other customers, keep data secure. |
| AI-generated content | ⚠️ | Reels API exposes `is_ai_generated`; Meta's labeling policies for AI content evolve — surface an "AI-assisted" toggle per post and pass the flag where supported. |

---

## 7. Insights / analytics availability

| Metric | Status | Detail |
|---|---|---|
| `impressions` (Page and post) | ✅ deprecated | Removed **2025-11-15** on all versions; replaced by **`views`**. |
| Page fans metrics | ✅ deprecated | Removed 2025-11-15; no replacement. |
| Reach metrics (`page_impressions_unique`, `post_impressions_unique`, paid/organic/viral splits) | ⚠️ deprecated | Reported deprecated with v25.0 (mid-2026). Closest replacements: `page_total_media_view_unique`, `post_total_media_view_unique` — **not 1:1**. Historical data for removed metrics no longer available. |
| Reactions, comments, shares counts on a post | ⚠️ | Available through post fields/summary edges with `pages_read_engagement`; verify field names on v26 in M3.4. |
| Link clicks (organic) | ❓ | Historically `post_clicks*`; status on v26 unverified. **Plan:** add UTM parameters to every link and measure clicks on our own sites (reliable and Meta-independent). |

**What we can promise:** posts published, success/failure rates (our data), views and engagement counts *where Meta exposes them*, and click-throughs via UTM on owned sites.

---

## 8. Marketing API (paid ads — Phase 5)

| Topic | Status | Detail |
|---|---|---|
| Access tiers | ✅ | Renamed **2026-05-04**: "Ads Management Standard Access" → **Marketing API Access Tier**; Standard → **Limited Access** (default, development only, heavy per-ad-account rate limits, 1 system user); Advanced → **Full Access** (light rate limits, full Business Manager API, 10 system users). |
| Full Access requirements | ✅ | ≥ **500** successful Marketing API calls in the past 15 days and error rate < **15%** over the last 500 calls; requested via App Review; screen recording no longer required. |
| Permissions | ✅ | `ads_management` (create/manage campaigns; depends on `pages_read_engagement`, `pages_show_list`), `ads_read` (reporting). Advanced access + Business Verification needed for other businesses' ad accounts; Tech Provider verification also applies. |
| Own ad accounts | ✅ (inferred) | With Limited Access, admins/developers of the app can manage ad accounts they administer — enough for internal drafting/testing. |
| Special Ad Categories | ✅ | Every new/edited campaign must declare `special_ad_categories` (or `NONE`). **`FINANCIAL_PRODUCTS_SERVICES`** (replaced `CREDIT` in Jan 2025) is mandatory in the US for financial products — **LimitKeep ads very likely fall here.** Restrictions: age fixed 18–65+, no gender targeting, ≥15-mile radius around locations, no ZIP targeting, no lookalikes, limited detailed targeting. |
| Political/issue ads | ✅ | Require authorization; not allowed in the EU since 2025-10-06. Out of scope. |
| Safety requirements (ours) | — | Draft-only first; explicit human confirmation for create/launch/budget change; per-org daily/lifetime spend ceilings checked server-side; audit logs; "pause all" switch; no automatic launches in the initial ads release. |

---

## 9. Instagram (Phase 5 preview)

| Item | Status | Detail |
|---|---|---|
| Account type | ✅ | Instagram **professional** account (Business or Creator). |
| Login options | ✅ | Instagram API with Facebook Login (Page token; `graph.facebook.com`), with Instagram Login (`graph.instagram.com`), or "Unified Login" via Facebook Login for Business (BISU). **Reuse our Facebook Login for Business flow.** Resumable uploads only for apps using Facebook Login for Business. |
| Media | ✅ | Images **JPEG only**; video, Reels, Stories, carousels up to 20 items. |
| Publishing limit | ⚠️ | Docs state **100 API-published posts per 24 h** (carousel = 1) but another passage says 50. Read `GET /{ig-user-id}/content_publishing_limit` at runtime. |
| Permissions | ✅ | `instagram_basic`, `instagram_content_publish` (+ Page permissions when using Facebook Login). |

---

## 10. Requirements for customers connecting their own Pages (Phase 4)

1. Meta app has **Advanced Access** for the Page permissions (App Review) and the owning business is **business-verified**.
2. Owning business is a verified **Tech Provider** (Access Verification).
3. App is **published/Live** with privacy policy, terms, data deletion callback, deauthorize callback.
4. Customer must have the **CREATE_CONTENT** task (or full control) on the Page; if Page is in a Business portfolio, they must select it during the Facebook Login for Business flow.
5. Customer can revoke access any time (Facebook settings → Business Integrations, or Business Manager); our deauthorize callback must clean up.

---

## 11. Open questions to resolve in spikes

| # | Question | Resolve in |
|---|---|---|
| Q1 | Are posts published by our unreviewed Business app (Standard Access) publicly visible? | M0.2 |
| Q2 | Exact Facebook Login for Business configuration options for "User access token" with Pages (asset selection UX). | M0.2 / M1.4 |
| Q3 | Multi-photo `attached_media` and photo alt text support on v26. | M1.6 |
| Q4 | Is `publish_video` needed for non-live Page video? | M2.5 |
| Q5 | Which post engagement fields remain on v26 (reactions/comments/shares/clicks)? | M3.4 |
| Q6 | BISU vs user-derived Page tokens for customers. | M4.3 |
| Q7 | Current App Review submission form requirements (screencast format, test users). | M4.3 |
| Q8 | Meta's current error code for duplicate status messages (commonly reported as 506) — confirm and map to "permanent". | M1.5 |

---

## 12. Sources (official unless noted)

- Pages API — Posts: https://developers.facebook.com/documentation/pages-api/posts
- Pages API — Create an app ("Manage everything on your Page"): https://developers.facebook.com/documentation/pages-api/create-an-app
- Graph API versions: https://developers.facebook.com/docs/graph-api/changelog/versions/
- Graph API v26.0 changelog: https://developers.facebook.com/docs/graph-api/changelog/version26.0/
- Access levels: https://developers.facebook.com/docs/graph-api/overview/access-levels/
- Permissions reference: https://developers.facebook.com/docs/permissions
- Access Verification (Tech Providers): https://developers.facebook.com/docs/development/release/access-verification/
- Facebook Login for Business: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/
- Long-lived tokens: https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived
- Rate limiting: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- Video API publishing: https://developers.facebook.com/documentation/video-api/guides/publishing
- Reels Publishing API: https://developers.facebook.com/documentation/video-api/guides/reels-publishing
- Page Insights API updates (Aug 2025): https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/
- Groups API deprecation (v19.0): https://developers.facebook.com/docs/graph-api/changelog/version19.0/
- Marketing API access & authorization: https://developers.facebook.com/docs/marketing-api/access/
- Marketing API Access Tier update (May 2026): https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/
- Special Ad Categories: https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/special-ad-category
- Instagram content publishing: https://developers.facebook.com/documentation/instagram-platform/content-publishing
- Secondary (used only for flagged ⚠️ items): Fixmation, "On 27 October Meta changes every Graph API version" — https://fixmation.dev/blog/meta-graph-api-27-october-all-versions ; Coupler.io, "Meta Facebook Insights deprecated metrics June 2026" — https://docs.coupler.io/sources/category/social-media/facebook-page-insights/data-overview/meta-facebook-insights-deprecated-metrics-june-2026
