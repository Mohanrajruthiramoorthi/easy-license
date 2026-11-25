-- Migration F: memberships. One login (person) can belong to many businesses, as owner of some and user of others.
--  * public.users is now the PERSON (login). Platform role is 'super_admin' or 'user'.
--  * public.memberships links a person to a business with a role (business_owner | user). Removing a person from a
--    business soft-deletes only that membership; their login and other businesses are untouched.
--  * Access is evaluated per business: access_state(user, business). Owner locked => that business locked only.
select private.set_context(null, 'system', 'migration:f', null, null, 'Memberships migration');

-- 1. memberships table
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  role text not null check (role in ('business_owner','user')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid, delete_reason text,
  constraint memberships_delete_reason_chk check (deleted_at is null or char_length(btrim(coalesce(delete_reason,''))) >= 3)
);
create unique index memberships_live_key on public.memberships (user_id, business_id) where deleted_at is null;
create index memberships_business_idx on public.memberships (business_id);
create index memberships_user_idx on public.memberships (user_id);
alter table public.memberships enable row level security;
create trigger memberships_audit after insert or update or delete on public.memberships for each row execute function private.audit_row();
create trigger memberships_no_delete before delete on public.memberships for each row execute function private.block_hard_delete();
create trigger memberships_no_truncate before truncate on public.memberships for each statement execute function private.block_log_change();
grant select on public.memberships to authenticated, service_role;

-- 2. holds: a hold can also target a membership (one person in one business); person-level holds have no business
alter table public.holds alter column business_id drop not null;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.holds'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%target_type%' loop
    execute format('alter table public.holds drop constraint %I', c);
  end loop;
end $$;
alter table public.holds add constraint holds_target_type_check check (target_type in ('licence','business','user','membership'));

-- 3. backfill memberships from the old one-profile-one-business rows
insert into public.memberships (user_id, business_id, role, status, deleted_at, deleted_by, delete_reason, created_at)
select u.id, u.business_id, u.role, u.status, u.deleted_at, u.deleted_by, u.delete_reason, u.created_at
  from public.users u where u.business_id is not null and u.role in ('business_owner','user');

-- 4. users becomes the person only
alter table public.users drop constraint users_business_required;
alter table public.users drop constraint users_role_check;
update public.users set role = 'user' where role = 'business_owner';
update public.users set status = 'active' where role <> 'super_admin';
alter table public.users add constraint users_role_check check (role in ('super_admin','user'));
drop index if exists public.users_business_id_idx;

-- 5. invites: one open invite per email PER business (a person can be invited to several)
drop index public.invites_open_email_key;
create unique index invites_open_email_business_key on public.invites (business_id, lower(email)) where deleted_at is null and claimed_at is null;

-- 6. policies and helpers that depended on users.business_id
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
alter table public.users drop column business_id;
drop function private.my_mode();
drop function private.my_business_id();
drop function private.access_state(uuid);

create or replace function private.entity_table(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'business' then 'businesses' when 'user' then 'users' when 'licence' then 'licences'
                when 'payment' then 'payments' when 'invite' then 'invites' when 'membership' then 'memberships' end $$;

-- Access for one person in one business. p_business null => person-level checks only.
create function private.access_state(p_user uuid, p_business uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u record; m record; b record; om record; lic uuid; vu timestamptz;
begin
  select id, role, status, deleted_at into u from public.users where id = p_user;
  if not found or u.deleted_at is not null then return jsonb_build_object('mode','blocked','reason','no_profile'); end if;
  if u.status <> 'active' then return jsonb_build_object('mode','blocked','reason','user_inactive'); end if;
  if u.role = 'super_admin' then return jsonb_build_object('mode','full','reason','ok'); end if;
  if private.open_hold_exists('user', u.id) then return jsonb_build_object('mode','blocked','reason','user_held'); end if;
  if p_business is null then return jsonb_build_object('mode','full','reason','ok'); end if;
  select id, status into m from public.memberships where user_id = p_user and business_id = p_business and deleted_at is null;
  if not found then return jsonb_build_object('mode','blocked','reason','not_member'); end if;
  if m.status <> 'active' then return jsonb_build_object('mode','blocked','reason','membership_inactive'); end if;
  if private.open_hold_exists('membership', m.id) then return jsonb_build_object('mode','blocked','reason','membership_held'); end if;
  select id, owner_id, deleted_at into b from public.businesses where id = p_business;
  if not found or b.deleted_at is not null then return jsonb_build_object('mode','blocked','reason','business_deleted'); end if;
  if private.open_hold_exists('business', b.id) then return jsonb_build_object('mode','blocked','reason','business_held'); end if;
  if b.owner_id is not null then
    if private.open_hold_exists('user', b.owner_id) then return jsonb_build_object('mode','blocked','reason','owner_held'); end if;
    select id into om from public.memberships where user_id = b.owner_id and business_id = b.id and deleted_at is null;
    if om.id is not null and private.open_hold_exists('membership', om.id) then
      return jsonb_build_object('mode','blocked','reason','owner_held');
    end if;
  end if;
  lic := private.current_licence_id(b.id);
  if lic is null then
    return jsonb_build_object('mode','read_only','reason',
      case when exists (select 1 from public.licences where business_id = b.id and deleted_at is null and status = 'pending') then 'licence_pending'
           when exists (select 1 from public.licences where business_id = b.id and deleted_at is null and status = 'revoked') then 'licence_revoked'
           else 'no_licence' end);
  end if;
  if private.open_hold_exists('licence', lic) then return jsonb_build_object('mode','blocked','reason','licence_held'); end if;
  vu := private.licence_valid_until(lic);
  if now() >= vu then return jsonb_build_object('mode','read_only','reason','licence_expired','licence_id',lic); end if;
  return jsonb_build_object('mode','full','reason','ok','licence_id',lic,'valid_until',vu);
end $$;

-- The caller is an active owner of the business (and, if p_full, the business is fully usable)
create function private.owns(p_business uuid, p_full boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.business_id = p_business
                   and m.role = 'business_owner' and m.deleted_at is null and m.status = 'active')
     and (private.access_state(auth.uid(), p_business)->>'mode') = any (case when p_full then array['full'] else array['full','read_only'] end) $$;

-- The caller is an active member (any role) of the business and not blocked
create function private.member_of(p_business uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.business_id = p_business
                   and m.deleted_at is null and m.status = 'active')
     and (private.access_state(auth.uid(), p_business)->>'mode') <> 'blocked' $$;
grant execute on function private.owns(uuid, boolean), private.member_of(uuid), private.access_state(uuid, uuid) to authenticated;

create policy businesses_read on public.businesses for select to authenticated using (
  private.my_role() = 'super_admin' or (deleted_at is null and private.member_of(id)));
create policy memberships_read on public.memberships for select to authenticated using (
  private.my_role() = 'super_admin'
  or (deleted_at is null and (user_id = auth.uid() or private.owns(business_id, false))));
create policy users_read on public.users for select to authenticated using (
  id = auth.uid() or private.my_role() = 'super_admin'
  or (deleted_at is null and exists (select 1 from public.memberships m
        where m.user_id = users.id and m.deleted_at is null and private.owns(m.business_id, false))));
create policy licences_read on public.licences for select to authenticated using (
  private.my_role() = 'super_admin' or (deleted_at is null and private.owns(business_id, false)));
create policy payments_read on public.payments for select to authenticated using (
  private.my_role() = 'super_admin' or (deleted_at is null and private.owns(business_id, false)));
create policy invites_read on public.invites for select to authenticated using (
  private.my_role() = 'super_admin' or (deleted_at is null and private.owns(business_id, false)));
create policy holds_read on public.holds for select to authenticated using (private.my_role() = 'super_admin');
create policy audit_read on public.audit_log for select to authenticated using (private.my_role() = 'super_admin');
create policy events_read on public.event_log for select to authenticated using (private.my_role() = 'super_admin');

-- 7. commands (dashboard)
create or replace function public.cmd_create_business(p_name text, p_owner_email text, p_owner_name text default null,
  p_owner_phone text default null, p_profile jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bid uuid; bno bigint; em text := lower(btrim(coalesce(p_owner_email, ''))); eu uuid; mid uuid;
begin
  perform private.require_admin();
  perform private.begin_command('Business created by app owner');
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Business name is required'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid owner email is required'; end if;
  insert into public.businesses (name, legal_name, business_type, email, phone, address_line, city, state, pincode, country, gstin, registration_no, website)
  values (btrim(p_name), nullif(btrim(p_profile->>'legal_name'), ''), nullif(btrim(p_profile->>'business_type'), ''),
    nullif(btrim(p_profile->>'email'), ''), nullif(btrim(p_profile->>'phone'), ''), nullif(btrim(p_profile->>'address_line'), ''),
    nullif(btrim(p_profile->>'city'), ''), nullif(btrim(p_profile->>'state'), ''), nullif(btrim(p_profile->>'pincode'), ''),
    coalesce(nullif(btrim(p_profile->>'country'), ''), 'IN'), nullif(btrim(p_profile->>'gstin'), ''),
    nullif(btrim(p_profile->>'registration_no'), ''), nullif(btrim(p_profile->>'website'), ''))
  returning id, business_no into bid, bno;
  select id into eu from public.users where lower(email) = em and deleted_at is null;
  if eu is not null then
    insert into public.memberships (user_id, business_id, role) values (eu, bid, 'business_owner') returning id into mid;
    update public.businesses set owner_id = eu where id = bid;
    return jsonb_build_object('ok', true, 'business_id', bid, 'business_no', bno, 'owner_added', true);
  end if;
  insert into public.invites (business_id, email, name, phone, role) values (bid, em, nullif(btrim(p_owner_name), ''), nullif(btrim(p_owner_phone), ''), 'business_owner');
  return jsonb_build_object('ok', true, 'business_id', bid, 'business_no', bno, 'owner_added', false);
end $$;

create or replace function public.cmd_update_business(p_business_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text; allowed text[] := array['name','legal_name','business_type','email','phone','address_line','city','state','pincode','country','gstin','registration_no','website'];
begin
  if private.my_role() = 'super_admin' then null;
  elsif private.owns(p_business_id, false) then null;
  else raise exception 'Not allowed' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(allowed)) then raise exception 'Field % cannot be changed', k; end if;
  end loop;
  perform private.begin_command('Business profile updated');
  update public.businesses b set
    name = coalesce(case when p_patch ? 'name' then nullif(btrim(p_patch->>'name'), '') end, b.name),
    legal_name = case when p_patch ? 'legal_name' then nullif(btrim(p_patch->>'legal_name'), '') else b.legal_name end,
    business_type = case when p_patch ? 'business_type' then nullif(btrim(p_patch->>'business_type'), '') else b.business_type end,
    email = case when p_patch ? 'email' then nullif(btrim(p_patch->>'email'), '') else b.email end,
    phone = case when p_patch ? 'phone' then nullif(btrim(p_patch->>'phone'), '') else b.phone end,
    address_line = case when p_patch ? 'address_line' then nullif(btrim(p_patch->>'address_line'), '') else b.address_line end,
    city = case when p_patch ? 'city' then nullif(btrim(p_patch->>'city'), '') else b.city end,
    state = case when p_patch ? 'state' then nullif(btrim(p_patch->>'state'), '') else b.state end,
    pincode = case when p_patch ? 'pincode' then nullif(btrim(p_patch->>'pincode'), '') else b.pincode end,
    country = coalesce(case when p_patch ? 'country' then nullif(btrim(p_patch->>'country'), '') end, b.country),
    gstin = case when p_patch ? 'gstin' then nullif(btrim(p_patch->>'gstin'), '') else b.gstin end,
    registration_no = case when p_patch ? 'registration_no' then nullif(btrim(p_patch->>'registration_no'), '') else b.registration_no end,
    website = case when p_patch ? 'website' then nullif(btrim(p_patch->>'website'), '') else b.website end,
    updated_at = now()
  where b.id = p_business_id and b.deleted_at is null;
  if not found then raise exception 'Business not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Person-level status (all businesses). App owner only.
create or replace function public.cmd_set_user_status(p_user uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text := private.need_reason(p_reason); t record;
begin
  perform private.require_admin();
  if p_status not in ('active','inactive') then raise exception 'Invalid status'; end if;
  select id, role into t from public.users where id = p_user and deleted_at is null;
  if not found then raise exception 'User not found'; end if;
  if t.role = 'super_admin' and p_user = auth.uid() then raise exception 'You cannot change your own status'; end if;
  perform private.begin_command(r);
  update public.users set status = p_status where id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- One person in one business. App owner, or the business owner for people with the 'user' role.
create function public.cmd_set_membership_status(p_membership uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text := private.need_reason(p_reason); m record;
begin
  if p_status not in ('active','inactive') then raise exception 'Invalid status'; end if;
  select id, user_id, business_id, role into m from public.memberships where id = p_membership and deleted_at is null;
  if not found then raise exception 'Membership not found'; end if;
  if private.my_role() = 'super_admin' then null;
  elsif private.owns(m.business_id, true) and m.role = 'user' then null;
  else raise exception 'Not allowed' using errcode = '42501'; end if;
  perform private.begin_command(r);
  update public.memberships set status = p_status where id = p_membership;
  return jsonb_build_object('ok', true);
end $$;

-- Remove a person from ONE business (soft delete). Their login and other businesses stay.
create function public.cmd_remove_member(p_membership uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text := private.need_reason(p_reason); m record; b record; nxt uuid;
begin
  select id, user_id, business_id, role into m from public.memberships where id = p_membership and deleted_at is null;
  if not found then raise exception 'Membership not found'; end if;
  if private.my_role() = 'super_admin' then null;
  elsif private.owns(m.business_id, true) and m.role = 'user' then null;
  else raise exception 'Not allowed' using errcode = '42501'; end if;
  perform private.begin_command(r);
  update public.memberships set deleted_at = now(), deleted_by = auth.uid(), delete_reason = r where id = p_membership;
  select id, owner_id into b from public.businesses where id = m.business_id;
  if b.owner_id = m.user_id then
    select user_id into nxt from public.memberships
     where business_id = m.business_id and role = 'business_owner' and deleted_at is null and status = 'active' order by created_at limit 1;
    update public.businesses set owner_id = nxt where id = m.business_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cmd_cancel_invite(p_invite uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text := private.need_reason(p_reason); i record;
begin
  select id, business_id into i from public.invites where id = p_invite and deleted_at is null and claimed_at is null;
  if not found then raise exception 'Invite not found'; end if;
  if private.my_role() = 'super_admin' then null;
  elsif private.owns(i.business_id, true) then null;
  else raise exception 'Not allowed' using errcode = '42501'; end if;
  perform private.begin_command(r);
  update public.invites set deleted_at = now(), deleted_by = auth.uid(), delete_reason = r where id = p_invite;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cmd_place_hold(p_target_type text, p_target_id uuid, p_reason_code text, p_note text default null,
  p_release_at timestamptz default null, p_rollover boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bid uuid; hid uuid; trole text; ok boolean := false;
begin
  perform private.require_admin();
  perform private.settle_holds();
  perform private.begin_command(p_reason_code || coalesce(': ' || nullif(btrim(p_note), ''), ''));
  if p_target_type = 'licence' then
    select business_id into bid from public.licences where id = p_target_id and deleted_at is null; ok := found;
  elsif p_target_type = 'business' then
    select id into bid from public.businesses where id = p_target_id and deleted_at is null; ok := found;
  elsif p_target_type = 'membership' then
    select business_id into bid from public.memberships where id = p_target_id and deleted_at is null; ok := found;
  elsif p_target_type = 'user' then
    select role into trole from public.users where id = p_target_id and deleted_at is null; ok := found;
    if trole = 'super_admin' then raise exception 'The app owner account cannot be put on hold'; end if;
  else raise exception 'Unknown hold target'; end if;
  if not ok then raise exception 'Target not found'; end if;
  if p_reason_code = 'other' and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'A note is required for reason "other"'; end if;
  begin
    insert into public.holds (target_type, target_id, business_id, reason_code, note, rollover, placed_by, release_at)
    values (p_target_type, p_target_id, bid, p_reason_code, nullif(btrim(p_note), ''),
      coalesce(p_rollover, p_reason_code <> 'non_payment'), auth.uid(), p_release_at) returning id into hid;
  exception when unique_violation then
    raise exception 'This target already has an open hold with that reason';
  end;
  return jsonb_build_object('ok', true, 'hold_id', hid);
end $$;

create or replace function public.cmd_timeline(p_business_id uuid default null, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare lim int := least(greatest(coalesce(p_limit, 100), 1), 500); bid uuid := p_business_id; res jsonb; adm boolean := private.my_role() = 'super_admin';
begin
  if not adm then
    if bid is not null and private.owns(bid, false) then null;
    else raise exception 'Not allowed' using errcode = '42501'; end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) into res from (
    select * from (
      select a.at, 'change'::text as kind, a.table_name || '.' || a.action as what, a.actor_id, a.actor_role, a.reason,
             null::text as outcome, a.business_id, a.row_id, a.changed_columns, a.source,
             case when adm then a.ip end as ip
        from public.audit_log a where bid is null or a.business_id = bid
      union all
      select e.at, 'event', e.event, e.actor_id, null, e.reason, e.outcome, e.business_id, e.user_id, null, e.actor_type,
             case when adm then e.ip end
        from public.event_log e where (bid is null and adm) or e.business_id = bid
    ) u order by u.at desc limit lim) x;
  return res;
end $$;

-- 8. API functions (Edge Functions, service role only)
create or replace function public.app_register_business(p_user_id uuid, p_name text, p_email text, p_phone text, p_business_name text,
  p_trial_days int, p_ip text default null, p_request_id text default null, p_user_agent text default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bid uuid; bno bigint; em text := lower(btrim(coalesce(p_email, ''))); today date := (now() at time zone 'Asia/Kolkata')::date;
        u record; owned int;
begin
  perform private.set_context(p_user_id, 'service', 'edge:register', p_request_id, p_ip, 'Self registration', p_client_id);
  select id, deleted_at into u from public.users where id = p_user_id;
  if found and u.deleted_at is not null then
    perform private.log_event('register.attempt', 'blocked', 'account_deactivated', null, p_user_id, null);
    return jsonb_build_object('ok', false, 'code', 'account_deactivated', 'message', 'This account has been deactivated. Contact support.');
  end if;
  if char_length(btrim(coalesce(p_business_name, ''))) < 2 or char_length(btrim(coalesce(p_name, ''))) < 2 then
    perform private.log_event('register.attempt', 'failed', 'invalid_input', null, p_user_id, null);
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'Name and business name are required.');
  end if;
  select count(*) into owned from public.memberships where user_id = p_user_id and role = 'business_owner' and deleted_at is null;
  if owned >= 3 then
    perform private.log_event('register.attempt', 'blocked', 'too_many_businesses', null, p_user_id, null);
    return jsonb_build_object('ok', false, 'code', 'too_many_businesses', 'message', 'You already own the maximum number of self-registered businesses. Contact support to add more.');
  end if;
  if not found then
    insert into public.users (id, name, email, phone, role, status) values (p_user_id, btrim(p_name), em, p_phone, 'user', 'active');
  end if;
  insert into public.businesses (name) values (btrim(p_business_name)) returning id, business_no into bid, bno;
  insert into public.memberships (user_id, business_id, role) values (p_user_id, bid, 'business_owner');
  update public.businesses set owner_id = p_user_id where id = bid;
  insert into public.licences (business_id, plan, start_date, expiry_date, status) values (bid, 'trial', today, today + greatest(p_trial_days, 1), 'active');
  perform private.log_event('register.succeeded', 'succeeded', null, bid, p_user_id, jsonb_build_object('ua', p_user_agent, 'trial_days', p_trial_days));
  return jsonb_build_object('ok', true, 'business_id', bid, 'business_no', bno);
end $$;

-- After a Google sign-in: create the person if invited, and turn every open invite for their email into a membership
create or replace function public.app_claim_invite(p_user_id uuid, p_email text, p_name text default null, p_phone text default null,
  p_ip text default null, p_request_id text default null, p_user_agent text default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv record; em text := lower(btrim(coalesce(p_email, ''))); u record; claimed int := 0; first_biz uuid;
begin
  perform private.set_context(p_user_id, 'service', 'edge:claim-profile', p_request_id, p_ip, 'Invite claimed', p_client_id);
  select id, deleted_at into u from public.users where id = p_user_id;
  if found and u.deleted_at is not null then
    perform private.log_event('invite.claim', 'blocked', 'account_deactivated', null, p_user_id, null);
    return jsonb_build_object('ok', false, 'code', 'account_deactivated', 'message', 'This account has been deactivated. Contact support.');
  end if;
  if not exists (select 1 from public.invites where lower(email) = em and deleted_at is null and claimed_at is null) then
    if found then return jsonb_build_object('ok', true, 'code', 'already_claimed'); end if;
    perform private.log_event('invite.claim', 'blocked', 'no_invite', null, p_user_id, null);
    return jsonb_build_object('ok', false, 'code', 'no_invite', 'message', 'No invite found for this email.');
  end if;
  if not found then
    select * into inv from public.invites where lower(email) = em and deleted_at is null and claimed_at is null order by created_at limit 1;
    insert into public.users (id, name, email, phone, role, status)
    values (p_user_id, coalesce(nullif(btrim(inv.name), ''), nullif(btrim(p_name), ''), split_part(em, '@', 1)), em, coalesce(inv.phone, p_phone), 'user', 'active');
  end if;
  for inv in select * from public.invites where lower(email) = em and deleted_at is null and claimed_at is null order by created_at loop
    if not exists (select 1 from public.memberships where user_id = p_user_id and business_id = inv.business_id and deleted_at is null) then
      insert into public.memberships (user_id, business_id, role) values (p_user_id, inv.business_id, inv.role);
      if inv.role = 'business_owner' then
        update public.businesses set owner_id = p_user_id where id = inv.business_id and owner_id is null;
      end if;
    end if;
    update public.invites set claimed_at = now(), claimed_by = p_user_id where id = inv.id;
    claimed := claimed + 1; first_biz := coalesce(first_biz, inv.business_id);
    perform private.log_event('invite.claim', 'succeeded', null, inv.business_id, p_user_id, jsonb_build_object('ua', p_user_agent));
  end loop;
  return jsonb_build_object('ok', true, 'claimed', claimed, 'business_id', first_biz);
end $$;

create or replace function public.app_create_invite(p_actor uuid, p_business_id uuid, p_email text, p_name text default null, p_phone text default null,
  p_role text default 'user', p_ip text default null, p_request_id text default null, p_user_agent text default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; em text := lower(btrim(coalesce(p_email, ''))); st jsonb; iid uuid; eu uuid; mid uuid; is_owner boolean;
begin
  perform private.set_context(p_actor, 'service', 'edge:enrol-user', p_request_id, p_ip, 'User enrolled', p_client_id);
  select id, role into a from public.users where id = p_actor and deleted_at is null and status = 'active';
  if not found then
    perform private.log_event('enrol.attempt', 'denied', 'no_profile', p_business_id, p_actor, null);
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Not allowed.');
  end if;
  st := private.access_state(p_actor, p_business_id);
  select exists (select 1 from public.memberships where user_id = p_actor and business_id = p_business_id
                  and role = 'business_owner' and deleted_at is null and status = 'active') into is_owner;
  if a.role = 'super_admin' then null;
  elsif is_owner and st->>'mode' = 'full' then null;
  else
    perform private.log_event('enrol.attempt', 'denied', coalesce(st->>'reason', 'role'), p_business_id, p_actor, null);
    return jsonb_build_object('ok', false, 'code', case when st->>'mode' = 'read_only' then 'read_only' else 'forbidden' end, 'message', 'You cannot add users right now.');
  end if;
  if p_role not in ('user','business_owner') or (p_role = 'business_owner' and a.role <> 'super_admin') then
    perform private.log_event('enrol.attempt', 'denied', 'bad_role', p_business_id, p_actor, null);
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Invalid role.');
  end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_email', 'message', 'Enter a valid email.');
  end if;
  if not exists (select 1 from public.businesses where id = p_business_id and deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Business not found.');
  end if;
  select id into eu from public.users where lower(email) = em and deleted_at is null;
  if eu is not null then
    if exists (select 1 from public.memberships where user_id = eu and business_id = p_business_id and deleted_at is null) then
      perform private.log_event('enrol.attempt', 'blocked', 'already_member', p_business_id, p_actor, null);
      return jsonb_build_object('ok', false, 'code', 'already_member', 'message', 'That person already belongs to this business.');
    end if;
    insert into public.memberships (user_id, business_id, role) values (eu, p_business_id, p_role) returning id into mid;
    if p_role = 'business_owner' then
      update public.businesses set owner_id = eu where id = p_business_id and owner_id is null;
    end if;
    perform private.log_event('enrol.member_added', 'succeeded', null, p_business_id, p_actor, jsonb_build_object('membership_id', mid, 'user_id', eu));
    return jsonb_build_object('ok', true, 'member_added', true, 'membership_id', mid);
  end if;
  if exists (select 1 from public.invites where business_id = p_business_id and lower(email) = em and deleted_at is null and claimed_at is null) then
    return jsonb_build_object('ok', false, 'code', 'already_invited', 'message', 'That email already has an open invite to this business.');
  end if;
  insert into public.invites (business_id, email, name, phone, role) values (p_business_id, em, nullif(btrim(p_name), ''), nullif(btrim(p_phone), ''), p_role) returning id into iid;
  perform private.log_event('enrol.created', 'succeeded', null, p_business_id, p_actor, jsonb_build_object('invite_id', iid));
  return jsonb_build_object('ok', true, 'invite_id', iid);
end $$;

-- 9. my_context: the person, plus every business they belong to with its own access mode
create or replace function public.my_context() returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); u record; st jsonb; s jsonb; r record; arr jsonb := '[]'::jsonb;
        best_rank int := -1; rk int; best_mode text := 'blocked'; best_reason text := 'no_membership'; best_vu jsonb;
begin
  if uid is null then return jsonb_build_object('mode','blocked','reason','not_signed_in','memberships','[]'::jsonb); end if;
  select id, name, email, phone, role, status into u from public.users where id = uid and deleted_at is null;
  if u.id is null then
    return jsonb_build_object('mode','blocked','reason','no_profile','profile',null,'memberships','[]'::jsonb);
  end if;
  st := private.access_state(uid, null);
  if st->>'mode' = 'blocked' then
    if not exists (select 1 from public.event_log where event = 'access.denied' and user_id = uid and business_id is null
                    and reason = st->>'reason' and at > now() - interval '1 hour') then
      perform private.log_event('access.denied', 'denied', st->>'reason', null, uid, null);
    end if;
    return jsonb_build_object('mode','blocked','reason',st->>'reason','memberships','[]'::jsonb,
      'profile', jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'phone',u.phone,'role',u.role,'status',u.status));
  end if;
  if u.role = 'super_admin' then
    return jsonb_build_object('mode','full','reason','ok','memberships','[]'::jsonb,
      'profile', jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'phone',u.phone,'role',u.role,'status',u.status));
  end if;
  for r in select m.id as mid, m.role as mrole, m.status as mstatus, b.id as bid, b.business_no, b.name as bname
             from public.memberships m join public.businesses b on b.id = m.business_id
            where m.user_id = uid and m.deleted_at is null and b.deleted_at is null order by b.business_no loop
    s := private.access_state(uid, r.bid);
    arr := arr || jsonb_build_array(jsonb_build_object('membership_id', r.mid, 'role', r.mrole,
      'business', jsonb_build_object('id', r.bid, 'business_no', r.business_no, 'name', r.bname),
      'mode', s->>'mode', 'reason', s->>'reason', 'valid_until', s->'valid_until'));
    rk := case s->>'mode' when 'full' then 2 when 'read_only' then 1 else 0 end;
    if rk > best_rank then best_rank := rk; best_mode := s->>'mode'; best_reason := s->>'reason'; best_vu := s->'valid_until'; end if;
    if s->>'mode' = 'blocked' and not exists (select 1 from public.event_log where event = 'access.denied' and user_id = uid
         and business_id = r.bid and reason = s->>'reason' and at > now() - interval '1 hour') then
      perform private.log_event('access.denied', 'denied', s->>'reason', r.bid, uid, null);
    end if;
  end loop;
  return jsonb_build_object('mode', best_mode, 'reason', best_reason, 'valid_until', best_vu, 'memberships', arr,
    'profile', jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'phone',u.phone,'role',u.role,'status',u.status));
end $$;

select private.lock_api_functions();
