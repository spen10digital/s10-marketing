-- 0001_core_tenancy: roles, context functions, identity, organizations, brands, voice
-- profiles, audit log and system flags, with RLS enabled and forced on every table.
--
-- Roles (02 §4.4):
--   app_owner  owns the schema; used only by migrations. In Aurora it is the cluster's master
--              user; locally it is a NOLOGIN role that owns the SECURITY DEFINER helpers.
--   app_rw     the application and workers. No BYPASSRLS. Its password is set by
--              scripts/db-migrate.ts from Secrets Manager (never stored in a migration).
--
-- Every request runs inside a transaction that first calls set_config('app.user_id' | 'app.actor'
-- | 'app.org_id', ..., true) (packages/core/src/db/context.ts). Policies only trust those values.
--
-- SECURITY DEFINER helpers run as app_owner, which is subject to forced RLS in Aurora (it owns
-- the tables) and locally (it does not). They therefore get narrow `to app_owner` policies on
-- exactly the tables they touch; app_rw never gets those policies.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_owner') then
    create role app_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw nologin;
  end if;
end
$$;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to app_rw, app_owner;
grant usage on schema public to app_rw, app_owner;

create type app.org_role as enum ('owner', 'admin', 'editor', 'viewer');

-- ---------------------------------------------------------------------------------------------
-- Request context
-- ---------------------------------------------------------------------------------------------

create function app.current_user_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app.current_actor() returns text
language sql stable
as $$ select coalesce(nullif(current_setting('app.actor', true), ''), 'user') $$;

create function app.current_system_org() returns uuid
language sql stable
as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

create function app.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 320),
  display_name text check (length(display_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on public.users (lower(email));

-- Issuer + subject (Cognito pool URL + sub), so a later move to the S10/Suite issuer is a data
-- migration rather than a rewrite (02 §3.4).
create table public.user_identities (
  issuer text not null check (issuer like 'https://%'),
  subject text not null check (length(subject) between 1 and 255),
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issuer, subject)
);
create index user_identities_user_idx on public.user_identities (user_id);

-- ---------------------------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  timezone text not null default 'America/Los_Angeles' check (length(timezone) <= 64),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role app.org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  description text check (length(description) <= 2000),
  website_url text check (website_url ~ '^https?://' and length(website_url) <= 2048),
  timezone text check (length(timezone) <= 64),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  archived_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, slug)
);

-- Append-only: every edit inserts the next version; the current profile is the highest version.
-- Lists are jsonb arrays because the RDS Data API cannot bind array parameters.
create table public.brand_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  brand_id uuid not null,
  version int not null check (version > 0),
  audience text not null default '' check (length(audience) <= 1000),
  tone text not null default '' check (length(tone) <= 500),
  guidelines text not null default '' check (length(guidelines) <= 4000),
  do_list jsonb not null default '[]' check (jsonb_typeof(do_list) = 'array'),
  dont_list jsonb not null default '[]' check (jsonb_typeof(dont_list) = 'array'),
  example_posts jsonb not null default '[]' check (jsonb_typeof(example_posts) = 'array'),
  cta_defaults jsonb not null default '[]' check (jsonb_typeof(cta_defaults) = 'array'),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (brand_id, version),
  foreign key (org_id, brand_id) references public.brands (org_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Ops
-- ---------------------------------------------------------------------------------------------

-- No FK to organizations: audit history outlives what it describes.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('user', 'system', 'automation', 'webhook')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (org_id, created_at desc);

-- Global kill switches (mirrors Parameter Store; both must allow an action). Not tenant data.
create table public.system_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.system_flags (key, enabled) values
  ('publishing_enabled', false),
  ('automation_enabled', false);

-- ---------------------------------------------------------------------------------------------
-- SECURITY DEFINER helpers (owned by app_owner, empty search_path)
-- ---------------------------------------------------------------------------------------------

create function app.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (app.current_actor() = 'system' and app.current_system_org() = p_org)
      or exists (select 1 from public.organization_members m
                 where m.org_id = p_org and m.user_id = app.current_user_id());
$$;

-- Roles are ordered owner < admin < editor < viewer, so "at least editor" is role <= 'editor'.
create function app.has_org_role(p_org uuid, p_min app.org_role) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (app.current_actor() = 'system' and app.current_system_org() = p_org)
      or exists (select 1 from public.organization_members m
                 where m.org_id = p_org and m.user_id = app.current_user_id() and m.role <= p_min);
$$;

-- Lets members see each other's profile rows without exposing every user.
create function app.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.organization_members mine
                 join public.organization_members theirs on theirs.org_id = mine.org_id
                 where mine.user_id = app.current_user_id() and theirs.user_id = p_user);
$$;

-- Maps a verified token's issuer + subject to a user id (null when not registered yet).
create function app.resolve_user(p_issuer text, p_subject text) returns uuid
language sql stable security definer set search_path = ''
as $$
  select i.user_id from public.user_identities i where i.issuer = p_issuer and i.subject = p_subject;
$$;

-- Called after the web app has verified the ID token and its email_verified claim. Idempotent and
-- safe under concurrent first requests. A verified email that already has a user (e.g. a Cognito
-- account recreated with the same address) links the new identity to that user.
create function app.register_user(p_issuer text, p_subject text, p_email text, p_display_name text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  select i.user_id into v_user from public.user_identities i
   where i.issuer = p_issuer and i.subject = p_subject;
  if v_user is not null then
    return v_user;
  end if;

  insert into public.users (email, display_name)
  values (p_email, nullif(btrim(p_display_name), ''))
  on conflict ((lower(email))) do nothing
  returning id into v_user;
  if v_user is null then
    select u.id into v_user from public.users u where lower(u.email) = lower(p_email);
  end if;

  insert into public.user_identities (issuer, subject, user_id)
  values (p_issuer, p_subject, v_user)
  on conflict (issuer, subject) do nothing;

  select i.user_id into v_user from public.user_identities i
   where i.issuer = p_issuer and i.subject = p_subject;
  return v_user;
end
$$;

-- Any signed-in user may create an organization and becomes its owner (M1.2: self-serve
-- onboarding, no seeded orgs). Creates the org and the owner membership atomically. Org slugs
-- are global, and callers cannot see other tenants' slugs, so a taken slug gets a random suffix
-- here instead of an error that would reveal another tenant.
create function app.create_organization(p_name text, p_slug text, p_timezone text) returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
  v_org uuid;
  v_slug text := p_slug;
begin
  if v_user is null or app.current_actor() <> 'user' then
    raise exception 'create_organization requires a signed-in user' using errcode = '42501';
  end if;
  for attempt in 1..5 loop
    begin
      insert into public.organizations (name, slug, timezone, created_by)
      values (btrim(p_name), v_slug, p_timezone, v_user)
      returning id into v_org;
      exit;
    exception when unique_violation then
      v_slug := left(p_slug, 56) || '-' || substr(md5(random()::text), 1, 6);
    end;
  end loop;
  if v_org is null then
    raise exception 'could not allocate an organization slug' using errcode = '23505';
  end if;
  insert into public.organization_members (org_id, user_id, role) values (v_org, v_user, 'owner');
  return v_org;
end
$$;

-- Row-level audit for tenant tables. Records changed column names, never values.
create function app.audit_row() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_changed jsonb := '[]';
  v_org uuid;
  v_entity uuid;
begin
  if tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  else
    v_org := (v_row ->> 'org_id')::uuid;
  end if;
  v_entity := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'user_id')::uuid);
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(n.key order by n.key), '[]') into v_changed
      from jsonb_each(to_jsonb(new)) n
     where n.key <> 'updated_at' and n.value is distinct from (to_jsonb(old) -> n.key);
  end if;

  insert into public.audit_logs (org_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    v_org,
    app.current_user_id(),
    app.current_actor(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_entity,
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', v_changed) else '{}'::jsonb end
  );
  return null;
end
$$;

alter function app.is_org_member(uuid) owner to app_owner;
alter function app.has_org_role(uuid, app.org_role) owner to app_owner;
alter function app.shares_org_with(uuid) owner to app_owner;
alter function app.resolve_user(text, text) owner to app_owner;
alter function app.register_user(text, text, text, text) owner to app_owner;
alter function app.create_organization(text, text, text) owner to app_owner;
alter function app.audit_row() owner to app_owner;

revoke all on all functions in schema app from public;
grant execute on function
  app.current_user_id(), app.current_actor(), app.current_system_org(),
  app.is_org_member(uuid), app.has_org_role(uuid, app.org_role), app.shares_org_with(uuid),
  app.resolve_user(text, text), app.register_user(text, text, text, text),
  app.create_organization(text, text, text)
  to app_rw;
grant execute on function app.current_user_id(), app.current_actor(), app.current_system_org()
  to app_owner;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

create trigger users_touch before update on public.users
  for each row execute function app.touch_updated_at();
create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();
create trigger brands_touch before update on public.brands
  for each row execute function app.touch_updated_at();

create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function app.audit_row();
create trigger organization_members_audit after insert or update or delete on public.organization_members
  for each row execute function app.audit_row();
create trigger brands_audit after insert or update or delete on public.brands
  for each row execute function app.audit_row();
create trigger brand_voice_profiles_audit after insert on public.brand_voice_profiles
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------------------------
-- Privileges (column-level where updates are allowed)
-- ---------------------------------------------------------------------------------------------

grant select, insert, update, delete on
  public.users, public.user_identities, public.organizations, public.organization_members,
  public.brands, public.brand_voice_profiles, public.audit_logs, public.system_flags
  to app_owner;

grant select on
  public.users, public.user_identities, public.organizations, public.organization_members,
  public.brands, public.brand_voice_profiles, public.audit_logs, public.system_flags
  to app_rw;
grant update (display_name) on public.users to app_rw;
grant update (name, timezone) on public.organizations to app_rw;
-- Inserts are table-level (the query builder names every column, defaults included); RLS
-- policies pin org_id and created_by. Updates are column-level so org_id can never change.
grant insert on public.brands, public.brand_voice_profiles to app_rw;
grant update (name, slug, description, website_url, timezone, settings, archived_at)
  on public.brands to app_rw;

-- ---------------------------------------------------------------------------------------------
-- Row-level security: enabled and forced everywhere
-- ---------------------------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.user_identities enable row level security;
alter table public.user_identities force row level security;
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
alter table public.brands enable row level security;
alter table public.brands force row level security;
alter table public.brand_voice_profiles enable row level security;
alter table public.brand_voice_profiles force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
alter table public.system_flags enable row level security;
alter table public.system_flags force row level security;

-- users: yourself and people you share an organization with; you may edit your display name.
create policy users_select on public.users for select to app_rw
  using (id = app.current_user_id() or app.shares_org_with(id));
create policy users_update_self on public.users for update to app_rw
  using (id = app.current_user_id()) with check (id = app.current_user_id());

create policy user_identities_select_self on public.user_identities for select to app_rw
  using (user_id = app.current_user_id());

-- organizations: created only through app.create_organization(); admins rename.
create policy organizations_select on public.organizations for select to app_rw
  using (app.is_org_member(id));
create policy organizations_update on public.organizations for update to app_rw
  using (app.has_org_role(id, 'admin')) with check (app.has_org_role(id, 'admin'));

-- organization_members: read-only for the app until invitations exist (Phase 4).
create policy organization_members_select on public.organization_members for select to app_rw
  using (app.is_org_member(org_id));

-- brands: members read; admins and owners create and edit; no hard delete (archive instead).
create policy brands_select on public.brands for select to app_rw
  using (app.is_org_member(org_id));
create policy brands_insert on public.brands for insert to app_rw
  with check (app.has_org_role(org_id, 'admin') and created_by = app.current_user_id());
create policy brands_update on public.brands for update to app_rw
  using (app.has_org_role(org_id, 'admin')) with check (app.has_org_role(org_id, 'admin'));

-- brand_voice_profiles: members read; editors and up append versions; versions are immutable.
create policy brand_voice_profiles_select on public.brand_voice_profiles for select to app_rw
  using (app.is_org_member(org_id));
create policy brand_voice_profiles_insert on public.brand_voice_profiles for insert to app_rw
  with check (app.has_org_role(org_id, 'editor') and created_by = app.current_user_id());

-- audit_logs: written only by app.audit_row(); org admins read their org's entries.
create policy audit_logs_select on public.audit_logs for select to app_rw
  using (org_id is not null and app.has_org_role(org_id, 'admin'));

create policy system_flags_select on public.system_flags for select to app_rw using (true);

-- Narrow policies for the SECURITY DEFINER helpers above (role app_owner only).
create policy users_definer on public.users for all to app_owner using (true) with check (true);
create policy user_identities_definer on public.user_identities for all to app_owner
  using (true) with check (true);
create policy organizations_definer_insert on public.organizations for insert to app_owner
  with check (true);
create policy organizations_definer_select on public.organizations for select to app_owner
  using (true);
create policy organization_members_definer on public.organization_members for all to app_owner
  using (true) with check (true);
create policy audit_logs_definer_insert on public.audit_logs for insert to app_owner
  with check (true);
