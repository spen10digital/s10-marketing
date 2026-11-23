-- 0004_suite_brands: a Suite business is a Marketing brand, created on first use for ANY business.
-- Nothing is seeded. Called after app.sync_suite_orgs with the businesses where this app is on for
-- the signed-in person; see docs/phases/suite-integration.md.

-- For the current user only, who must be a member of p_org (so the organization exists and is
-- already theirs). Creates a brand for each listed Suite business that has none (created_by = the
-- user), keeps the name in step with the Suite (the Suite owns the business name), and NEVER moves
-- a brand that is linked to another organization. Brands are never deleted or archived here: a
-- business that disappears from the list just stops being visible (the app filters by the list).
-- p_businesses: [{ "business_id", "name", "slug" }]. Returns every linked brand of the organization.
create function app.sync_suite_brands(p_org uuid, p_businesses jsonb)
returns table (o_brand_id uuid, o_suite_business_id text, o_slug text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
  v_biz jsonb;
  v_bid text;
  v_name text;
  v_slug text;
  v_brand uuid;
  v_owner uuid;
  v_try int;
begin
  if v_user is null or app.current_actor() <> 'user' then
    raise exception 'sync_suite_brands requires a signed-in user' using errcode = '42501';
  end if;
  if not app.is_org_member(p_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if jsonb_typeof(p_businesses) is distinct from 'array' then
    raise exception 'p_businesses must be a json array' using errcode = '22023';
  end if;

  for v_biz in select e from jsonb_array_elements(p_businesses) e loop
    v_bid := btrim(v_biz ->> 'business_id');
    if v_bid is null or length(v_bid) not between 1 and 64 then
      raise exception 'invalid business_id' using errcode = '22023';
    end if;
    v_name := left(coalesce(nullif(btrim(v_biz ->> 'name'), ''), 'Business'), 120);
    v_slug := left(coalesce(nullif(v_biz ->> 'slug', ''), 'business'), 56);

    select b.id, b.org_id into v_brand, v_owner from public.brands b where b.suite_business_id = v_bid;
    if v_brand is null then
      for v_try in 1..5 loop
        begin
          insert into public.brands (org_id, name, slug, created_by, suite_business_id)
          values (p_org, v_name, v_slug, v_user, v_bid)
          returning id into v_brand;
          exit;
        exception when unique_violation then
          -- Another request linked it first, or the slug is taken in this organization.
          select b.id into v_brand from public.brands b where b.suite_business_id = v_bid;
          exit when v_brand is not null;
          v_slug := left(v_slug, 49) || '-' || substr(md5(random()::text), 1, 6);
        end;
      end loop;
      if v_brand is null then
        raise exception 'could not create the brand' using errcode = '23505';
      end if;
    elsif v_owner = p_org then
      update public.brands b set name = v_name where b.id = v_brand and b.name is distinct from v_name;
    end if;
  end loop;

  return query
    select b.id, b.suite_business_id, b.slug
      from public.brands b
     where b.org_id = p_org and b.suite_business_id is not null
     order by b.name;
end
$$;

alter function app.sync_suite_brands(uuid, jsonb) owner to app_owner;
revoke all on function app.sync_suite_brands(uuid, jsonb) from public;
grant execute on function app.sync_suite_brands(uuid, jsonb) to app_rw;
