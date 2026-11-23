-- 0003_suite_link: link organizations to S10/Suite accounts (Proposed mapping, see
-- docs/phases/suite-integration.md). Local uuid keys stay; the Suite's ids (ULIDs) live in text
-- columns. Nothing is seeded or backfilled here: organizations are created the first time a
-- signed-in person's Suite account has this app (app.sync_suite_orgs), and existing rows are
-- linked only by scripts/link-suite-ids.ts with an explicit mapping file.

alter table public.organizations add column suite_account_id text;
alter table public.organizations
  add constraint organizations_suite_account_len
  check (suite_account_id is null or length(suite_account_id) between 1 and 64);
create unique index organizations_suite_account_key
  on public.organizations (suite_account_id) where suite_account_id is not null;

alter table public.brands add column suite_business_id text;
alter table public.brands
  add constraint brands_suite_business_len
  check (suite_business_id is null or length(suite_business_id) between 1 and 64);
create unique index brands_suite_business_key
  on public.brands (suite_business_id) where suite_business_id is not null;

-- The SECURITY DEFINER sync functions (role app_owner only) need these narrow policies.
create policy organizations_definer_update on public.organizations for update to app_owner
  using (true) with check (true);
create policy brands_definer on public.brands for all to app_owner using (true) with check (true);

-- Called after the web app has read /api/v1/me from the Suite as the signed-in person. For the
-- current user only (app.user_id): creates the organization for each listed account on first
-- use, sets the user's role from the Suite (roles are the Suite's to decide), keeps the name in
-- step, and removes the user from any Suite-linked organization that is no longer listed (access
-- taken away in the Suite takes effect here). Idempotent and safe under concurrent first requests.
-- p_accounts: [{ "account_id", "name", "slug", "role" }]. Returns the user's linked organizations.
-- Never call it without a real answer from the Suite: an empty list means "no access anywhere".
create function app.sync_suite_orgs(p_accounts jsonb)
returns table (
  o_org_id uuid, o_suite_account_id text, o_name text, o_slug text, o_timezone text, o_role app.org_role
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
  v_acct jsonb;
  v_aid text;
  v_org uuid;
  v_name text;
  v_slug text;
  v_role app.org_role;
  v_keep text[] := '{}';
  v_try int;
begin
  if v_user is null or app.current_actor() <> 'user' then
    raise exception 'sync_suite_orgs requires a signed-in user' using errcode = '42501';
  end if;
  if jsonb_typeof(p_accounts) is distinct from 'array' then
    raise exception 'p_accounts must be a json array' using errcode = '22023';
  end if;

  for v_acct in select e from jsonb_array_elements(p_accounts) e loop
    v_aid := btrim(v_acct ->> 'account_id');
    if v_aid is null or length(v_aid) not between 1 and 64 then
      raise exception 'invalid account_id' using errcode = '22023';
    end if;
    v_name := left(coalesce(nullif(btrim(v_acct ->> 'name'), ''), 'Workspace'), 120);
    v_slug := left(coalesce(nullif(v_acct ->> 'slug', ''), 'workspace'), 56);
    v_role := (v_acct ->> 'role')::app.org_role;
    v_keep := v_keep || v_aid;

    select o.id into v_org from public.organizations o where o.suite_account_id = v_aid;
    if v_org is null then
      for v_try in 1..5 loop
        begin
          insert into public.organizations (name, slug, timezone, created_by, suite_account_id)
          values (v_name, v_slug, 'America/Los_Angeles', v_user, v_aid)
          returning id into v_org;
          exit;
        exception when unique_violation then
          -- Another request created it first, or the slug is taken by another tenant.
          select o.id into v_org from public.organizations o where o.suite_account_id = v_aid;
          exit when v_org is not null;
          v_slug := left(v_slug, 49) || '-' || substr(md5(random()::text), 1, 6);
        end;
      end loop;
      if v_org is null then
        raise exception 'could not create the organization' using errcode = '23505';
      end if;
    else
      update public.organizations o set name = v_name
       where o.id = v_org and o.name is distinct from v_name;
    end if;

    insert into public.organization_members (org_id, user_id, role)
    values (v_org, v_user, v_role)
    on conflict (org_id, user_id) do update set role = excluded.role
      where public.organization_members.role is distinct from excluded.role;
  end loop;

  delete from public.organization_members m
   using public.organizations o
   where m.user_id = v_user
     and o.id = m.org_id
     and o.suite_account_id is not null
     and not (o.suite_account_id = any (v_keep));

  return query
    select o.id, o.suite_account_id, o.name, o.slug, o.timezone, m.role
      from public.organization_members m
      join public.organizations o on o.id = m.org_id
     where m.user_id = v_user and o.suite_account_id is not null
     order by o.name;
end
$$;

alter function app.sync_suite_orgs(jsonb) owner to app_owner;
revoke all on function app.sync_suite_orgs(jsonb) from public;
grant execute on function app.sync_suite_orgs(jsonb) to app_rw;
