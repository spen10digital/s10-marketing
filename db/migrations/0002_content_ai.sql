-- 0002_content_ai: content items, post drafts and revisions, AI generation records, usage
-- metering and per-org entitlements (05 §4). Same rules as 0001: org_id on every table,
-- unique (org_id, id), composite foreign keys, RLS enabled and forced, column-level updates.
--
-- Budget enforcement (ADR 0016): before every model call the app takes a per-org advisory lock,
-- sums this month's spend (finished generations at their real cost, recent pending ones at their
-- reserved estimate) and inserts a `pending` ai_generations row. The call runs outside the
-- transaction; a second transaction records the real tokens and cost and a usage_events row.

create type app.post_status as enum (
  'draft', 'awaiting_approval', 'approved', 'scheduled', 'publishing', 'published', 'failed',
  'needs_reconciliation', 'canceled', 'archived'
);

-- ---------------------------------------------------------------------------------------------
-- Entitlements (written by migrations / billing later, never by app_rw)
-- ---------------------------------------------------------------------------------------------

-- One row per org when it differs from the defaults in Parameter Store
-- (AI_DEFAULT_MONTHLY_BUDGET_USD and the code defaults for daily caps).
create table public.org_entitlements (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  ai_monthly_budget_micros bigint check (ai_monthly_budget_micros >= 0),
  ai_daily_calls int check (ai_daily_calls >= 0),
  web_fetch_daily int check (web_fetch_daily >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- AI generations and usage
-- ---------------------------------------------------------------------------------------------

create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  brand_id uuid not null,
  task text not null check (task ~ '^[a-z][a-z0-9_]*$' and length(task) <= 64),
  template_id text not null check (length(template_id) <= 64),
  template_version int not null check (template_version > 0),
  provider text not null check (length(provider) <= 32),
  model_id text not null check (length(model_id) <= 200),
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'invalid_output')),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cache_read_tokens int not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens int not null default 0 check (cache_write_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  latency_ms int check (latency_ms >= 0),
  error_code text check (length(error_code) <= 64),
  -- Website the voice assistant read, and a short excerpt of its text (never the whole page).
  source_url text check (source_url ~ '^https?://' and length(source_url) <= 2048),
  source_excerpt text check (length(source_excerpt) <= 2000),
  -- Validated structured output, so drafts can point back to what the model proposed.
  output jsonb check (output is null or jsonb_typeof(output) in ('object', 'array')),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, brand_id) references public.brands (org_id, id) on delete cascade
);
create index ai_generations_org_created_idx on public.ai_generations (org_id, created_at desc);
create index ai_generations_brand_created_idx on public.ai_generations (org_id, brand_id, created_at desc);

-- Append-only meter (02 §10: usage is metered from usage_events).
create table public.usage_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('ai_tokens', 'web_fetch')),
  quantity bigint not null check (quantity >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  ref_id uuid,
  created_by uuid references public.users (id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index usage_events_org_occurred_idx on public.usage_events (org_id, occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------------------------

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  brand_id uuid not null,
  kind text not null default 'post' check (kind in ('post', 'article', 'campaign')),
  title text check (length(title) <= 300),
  brief text check (length(brief) <= 4000),
  source_item_id uuid, -- FK added with source_items (0007)
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, brand_id) references public.brands (org_id, id) on delete cascade
);

-- target_id stays null until a Page is chosen (ADR 0018); its FK to social_targets arrives in 0003.
-- Approval and publishing columns arrive with 0004.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  brand_id uuid not null,
  content_item_id uuid,
  target_id uuid,
  status app.post_status not null default 'draft',
  body text not null default '' check (length(body) <= 63206),
  link_url text check (link_url ~ '^https?://' and length(link_url) <= 2048),
  content_hash text generated always as
    (md5(lower(regexp_replace(body, '\s+', ' ', 'g')) || coalesce(link_url, ''))) stored,
  ai_generation_id uuid,
  version int not null default 1 check (version > 0),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, brand_id) references public.brands (org_id, id) on delete cascade,
  foreign key (org_id, content_item_id) references public.content_items (org_id, id) on delete set null (content_item_id),
  foreign key (org_id, ai_generation_id) references public.ai_generations (org_id, id) on delete set null (ai_generation_id)
);
create index posts_brand_updated_idx on public.posts (org_id, brand_id, updated_at desc);

-- Every saved version of a post body (append-only).
create table public.post_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  post_id uuid not null,
  version int not null check (version > 0),
  body text not null check (length(body) <= 63206),
  link_url text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (post_id, version),
  foreign key (org_id, post_id) references public.posts (org_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

create trigger content_items_touch before update on public.content_items
  for each row execute function app.touch_updated_at();
create trigger posts_touch before update on public.posts
  for each row execute function app.touch_updated_at();

create trigger content_items_audit after insert or update on public.content_items
  for each row execute function app.audit_row();
create trigger posts_audit after insert or update on public.posts
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

grant select, insert, update, delete on
  public.org_entitlements, public.ai_generations, public.usage_events, public.content_items,
  public.posts, public.post_revisions
  to app_owner;

grant select on
  public.org_entitlements, public.ai_generations, public.usage_events, public.content_items,
  public.posts, public.post_revisions
  to app_rw;
grant insert on
  public.ai_generations, public.usage_events, public.content_items, public.posts, public.post_revisions
  to app_rw;
-- Only the outcome of a generation can change; who, what, which model and the reservation cannot.
grant update (status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
              cost_micros, latency_ms, error_code, output, finished_at)
  on public.ai_generations to app_rw;
grant update (title, brief) on public.content_items to app_rw;
grant update (body, link_url, version, content_item_id) on public.posts to app_rw;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table public.org_entitlements enable row level security;
alter table public.org_entitlements force row level security;
alter table public.ai_generations enable row level security;
alter table public.ai_generations force row level security;
alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;
alter table public.content_items enable row level security;
alter table public.content_items force row level security;
alter table public.posts enable row level security;
alter table public.posts force row level security;
alter table public.post_revisions enable row level security;
alter table public.post_revisions force row level security;

-- org_entitlements: members read their org's limits; nobody in the app can raise them.
create policy org_entitlements_select on public.org_entitlements for select to app_rw
  using (app.is_org_member(org_id));

-- ai_generations: members read; editors start generations as themselves and finish their own.
create policy ai_generations_select on public.ai_generations for select to app_rw
  using (app.is_org_member(org_id));
create policy ai_generations_insert on public.ai_generations for insert to app_rw
  with check (app.has_org_role(org_id, 'editor') and created_by = app.current_user_id()
              and status = 'pending');
create policy ai_generations_update on public.ai_generations for update to app_rw
  using (app.has_org_role(org_id, 'editor') and created_by = app.current_user_id()
         and status = 'pending')
  with check (app.has_org_role(org_id, 'editor') and created_by = app.current_user_id());

-- usage_events: members read; editors append their own events; never updated or deleted.
create policy usage_events_select on public.usage_events for select to app_rw
  using (app.is_org_member(org_id));
create policy usage_events_insert on public.usage_events for insert to app_rw
  with check (app.has_org_role(org_id, 'editor') and created_by = app.current_user_id());

-- content_items and posts: members read; editors create and edit. Only drafts can be edited
-- (M1.5 adds the approval transitions).
create policy content_items_select on public.content_items for select to app_rw
  using (app.is_org_member(org_id));
create policy content_items_insert on public.content_items for insert to app_rw
  with check (app.has_org_role(org_id, 'editor') and created_by = app.current_user_id());
create policy content_items_update on public.content_items for update to app_rw
  using (app.has_org_role(org_id, 'editor')) with check (app.has_org_role(org_id, 'editor'));

create policy posts_select on public.posts for select to app_rw
  using (app.is_org_member(org_id));
create policy posts_insert on public.posts for insert to app_rw
  with check (app.has_org_role(org_id, 'editor') and created_by = app.current_user_id()
              and status = 'draft');
create policy posts_update_draft on public.posts for update to app_rw
  using (app.has_org_role(org_id, 'editor') and status = 'draft')
  with check (app.has_org_role(org_id, 'editor') and status = 'draft');

create policy post_revisions_select on public.post_revisions for select to app_rw
  using (app.is_org_member(org_id));
create policy post_revisions_insert on public.post_revisions for insert to app_rw
  with check (app.has_org_role(org_id, 'editor') and created_by = app.current_user_id());
