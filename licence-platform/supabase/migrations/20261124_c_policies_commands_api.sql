-- Migration C: read-only RLS, cmd_* commands (dashboard), app_* functions (Edge Functions) (applied as phase1_c_policies_commands_api)
create or replace function private.my_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.users where id = auth.uid() and deleted_at is null and status = 'active' $$;
create or replace function private.my_business_id() returns uuid language sql stable security definer set search_path = '' as $$
  select business_id from public.users where id = auth.uid() and deleted_at is null and status = 'active' $$;

create policy businesses_read on public.businesses for select to authenticated using (
  private.my_role() = 'super_admin'
  or (id = private.my_business_id() and deleted_at is null and private.my_mode() <> 'blocked'));
create policy users_read on public.users for select to authenticated using (
  id = auth.uid() or private.my_role() = 'super_admin'
  or (private.my_role() = 'business_owner' and business_id = private.my_business_id() and deleted_at is null and private.my_mode() <> 'blocked'));
create policy licences_read on public.licences for select to authenticated using (
  private.my_role() = 'super_admin'
  or (private.my_role() = 'business_owner' and business_id = private.my_business_id() and deleted_at is null and private.my_mode() <> 'blocked'));
create policy payments_read on public.payments for select to authenticated using (
  private.my_role() = 'super_admin'
  or (private.my_role() = 'business_owner' and business_id = private.my_business_id() and deleted_at is null and private.my_mode() <> 'blocked'));
create policy invites_read on public.invites for select to authenticated using (
  private.my_role() = 'super_admin'
  or (private.my_role() = 'business_owner' and business_id = private.my_business_id() and deleted_at is null and private.my_mode() <> 'blocked'));
create policy holds_read on public.holds for select to authenticated using (private.my_role() = 'super_admin');
create policy audit_read on public.audit_log for select to authenticated using (private.my_role() = 'super_admin');
create policy events_read on public.event_log for select to authenticated using (private.my_role() = 'super_admin');

create function private.require_admin() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is distinct from 'super_admin' then
    raise exception 'Only the app owner can do this' using errcode = '42501';
  end if;
end $$;

create function private.need_reason(p text) returns text language plpgsql immutable set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p, ''))) < 3 then raise exception 'A reason (at least 3 characters) is required'; end if;
  return btrim(p);
end $$;

create function private.entity_table(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'business' then 'businesses' when 'user' then 'users' when 'licence' then 'licences'
                when 'payment' then 'payments' when 'invite' then 'invites' end $$;

create function private.settle_holds() returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.set_context(null, 'system', 'scheduler', null, null, 'auto-release');
  update public.holds set released_at = release_at, release_note = 'Auto-released at scheduled time'
   where released_at is null and release_at is not null and release_at <= now();
end $$;

create function public.cmd_create_business(p_name text, p_owner_email text, p_owner_name text default null,
  p_owner_phone text default null, p_profile jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bid uuid; bno bigint; em text := lower(btrim(coalesce(p_owner_email, '')));
begin
  perform private.require_admin();
  perform private.begin_command('Business created by app owner');
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Business name is required'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid owner email is required'; end if;
  if exists (select 1 from public.users where lower(email) = em and deleted_at is null) then
    raise exception 'That email already belongs to a user';
  end if;
  insert into public.businesses (name, legal_name, business_type, email, phone, address_line, city, state, pincode, country, gstin, registration_no, website)
  values (btrim(p_name), nullif(btrim(p_profile->>'legal_name'), ''), nullif(btrim(p_profile->>'business_type'), ''),
    nullif(btrim(p_profile->>'email'), ''), nullif(btrim(p_profile->>'phone'), ''), nullif(btrim(p_profile->>'address_line'), ''),
    nullif(btrim(p_profile->>'city'), ''), nullif(btrim(p_profile->>'state'), ''), nullif(btrim(p_profile->>'pincode'), ''),
    coalesce(nullif(btrim(p_profile->>'country'), ''), 'IN'), nullif(btrim(p_profile->>'gstin'), ''),
    nullif(btrim(p_profile->>'registration_no'), ''), nullif(btrim(p_profile->>'website'), ''))
  returning id, business_no into bid, bno;
  insert into public.invites (business_id, email, name, phone, role) values (bid, em, nullif(btrim(p_owner_name), ''), nullif(btrim(p_owner_phone), ''), 'business_owner');
  return jsonb_build_object('ok', true, 'business_id', bid, 'business_no', bno);
end $$;

create function public.cmd_update_business(p_business_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text; allowed text[] := array['name','legal_name','business_type','email','phone','address_line','city','state','pincode','country','gstin','registration_no','website'];
begin
  if private.my_role() = 'super_admin' then null;
  elsif private.my_role() = 'business_owner' and private.my_business_id() = p_business_id and private.my_mode() <> 'blocked' then null;
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

create function public.cmd_soft_delete(p_entity text, p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t text := private.entity_table(p_entity); r text := private.need_reason(p_reason); n int; trole text;
begin
  perform private.require_admin();
  if t is null then raise exception 'Unknown entity %', p_entity; end if;
  if p_entity = 'user' then
    if p_id = auth.uid() then raise exception 'You cannot delete your own account'; end if;
    select role into trole from public.users where id = p_id;
    if trole = 'super_admin' and not exists (select 1 from public.users where role = 'super_admin' and id <> p_id and deleted_at is null and status = 'active') then
      raise exception 'Cannot delete the last app owner';
    end if;
  end if;
  perform private.begin_command(r);
  execute format('update public.%I set deleted_at = now(), deleted_by = auth.uid(), delete_reason = $1 where id = $2 and deleted_at is null', t) using r, p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nothing to delete (not found or already deleted)'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.cmd_restore(p_entity text, p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t text := private.entity_table(p_entity); r text := private.need_reason(p_reason); n int;
begin
  perform private.require_admin();
  if t is null then raise exception 'Unknown entity %', p_entity; end if;
  perform private.begin_command(r);
  execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null where id = $1 and deleted_at is not null', t) using p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nothing to restore'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.cmd_set_user_status(p_user uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text := private.need_reason(p_reason); t record;
begin
  if p_status not in ('active','inactive') then raise exception 'Invalid status'; end if;
  select id, role, business_id into t from public.users where id = p_user and deleted_at is null;
  if not found then raise exception 'User not found'; end if;
  if private.my_role() = 'super_admin' then
    if t.role = 'super_admin' and p_user = auth.uid() then raise exception 'You cannot change your own status'; end if;
  elsif private.my_role() = 'business_owner' and t.business_id = private.my_business_id() and t.role = 'user' and private.my_mode() = 'full' then null;
  else raise exception 'Not allowed' using errcode = '42501'; end if;
  perform private.begin_command(r);
  update public.users set status = p_status where id = p_user;
  return jsonb_build_object('ok', true);
end $$;

create function public.cmd_cancel_invite(p_invite uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text := private.need_reason(p_reason); i record;
begin
  select id, business_id into i from public.invites where id = p_invite and deleted_at is null and claimed_at is null;
  if not found then raise exception 'Invite not found'; end if;
  if private.my_role() = 'super_admin' then null;
  elsif private.my_role() = 'business_owner' and i.business_id = private.my_business_id() and private.my_mode() = 'full' then null;
  else raise exception 'Not allowed' using errcode = '42501'; end if;
  perform private.begin_command(r);
  update public.invites set deleted_at = now(), deleted_by = auth.uid(), delete_reason = r where id = p_invite;
  return jsonb_build_object('ok', true);
end $$;

create function public.cmd_create_licence(p_business uuid, p_plan text, p_start date, p_expiry date, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lid uuid;
begin
  perform private.require_admin();
  if p_plan not in ('trial','paid') then raise exception 'Plan must be trial or paid'; end if;
  if p_start is null or p_expiry is null or p_expiry < p_start then raise exception 'Expiry must be on or after start'; end if;
  if not exists (select 1 from public.businesses where id = p_business and deleted_at is null) then raise exception 'Business not found'; end if;
  if p_plan = 'trial' and exists (select 1 from public.licences where business_id = p_business and plan = 'trial' and deleted_at is null) then
    raise exception 'This business already has a trial licence';
  end if;
  perform private.begin_command(coalesce(nullif(btrim(p_reason), ''), 'Licence created by app owner'));
  insert into public.licences (business_id, plan, start_date, expiry_date, status) values (p_business, p_plan, p_start, p_expiry, 'active') returning id into lid;
  return jsonb_build_object('ok', true, 'licence_id', lid);
end $$;

create function public.cmd_revoke_licence(p_licence uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text := private.need_reason(p_reason);
begin
  perform private.require_admin();
  perform private.begin_command(r);
  update public.licences set status = 'revoked' where id = p_licence and deleted_at is null and status <> 'revoked';
  if not found then raise exception 'Licence not found or already revoked'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.cmd_place_hold(p_target_type text, p_target_id uuid, p_reason_code text, p_note text default null,
  p_release_at timestamptz default null, p_rollover boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bid uuid; hid uuid; trole text;
begin
  perform private.require_admin();
  perform private.settle_holds();
  perform private.begin_command(p_reason_code || coalesce(': ' || nullif(btrim(p_note), ''), ''));
  if p_target_type = 'licence' then
    select business_id into bid from public.licences where id = p_target_id and deleted_at is null;
  elsif p_target_type = 'business' then
    select id into bid from public.businesses where id = p_target_id and deleted_at is null;
  elsif p_target_type = 'user' then
    select business_id, role into bid, trole from public.users where id = p_target_id and deleted_at is null;
    if trole = 'super_admin' then raise exception 'The app owner account cannot be put on hold'; end if;
  else raise exception 'Unknown hold target'; end if;
  if bid is null then raise exception 'Target not found'; end if;
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

create function public.cmd_release_hold(p_hold uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.settle_holds();
  perform private.begin_command(coalesce(nullif(btrim(p_note), ''), 'Hold released'));
  update public.holds set released_at = now(), released_by = auth.uid(), release_note = nullif(btrim(p_note), '')
   where id = p_hold and released_at is null;
  if not found then raise exception 'Hold not found or already released'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.cmd_timeline(p_business_id uuid default null, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare lim int := least(greatest(coalesce(p_limit, 100), 1), 500); bid uuid := p_business_id; res jsonb; adm boolean := private.my_role() = 'super_admin';
begin
  if not adm then
    if private.my_role() = 'business_owner' and private.my_mode() <> 'blocked' then bid := private.my_business_id();
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

create function public.app_register_business(p_user_id uuid, p_name text, p_email text, p_phone text, p_business_name text,
  p_trial_days int, p_ip text default null, p_request_id text default null, p_user_agent text default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare bid uuid; bno bigint; em text := lower(btrim(coalesce(p_email, ''))); today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform private.set_context(p_user_id, 'service', 'edge:register', p_request_id, p_ip, 'Self registration', p_client_id);
  if exists (select 1 from public.users where id = p_user_id and deleted_at is null) then
    perform private.log_event('register.attempt', 'blocked', 'already_registered', null, p_user_id, jsonb_build_object('ua', p_user_agent));
    return jsonb_build_object('ok', false, 'code', 'already_registered', 'message', 'You are already registered.');
  end if;
  if exists (select 1 from public.invites where lower(email) = em and deleted_at is null and claimed_at is null) then
    perform private.log_event('register.attempt', 'blocked', 'has_invite', null, p_user_id, null);
    return jsonb_build_object('ok', false, 'code', 'has_invite', 'message', 'You have been invited to a business. Accept the invite instead.');
  end if;
  if char_length(btrim(coalesce(p_business_name, ''))) < 2 or char_length(btrim(coalesce(p_name, ''))) < 2 then
    perform private.log_event('register.attempt', 'failed', 'invalid_input', null, p_user_id, null);
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'Name and business name are required.');
  end if;
  insert into public.businesses (name) values (btrim(p_business_name)) returning id, business_no into bid, bno;
  insert into public.users (id, business_id, name, email, phone, role, status) values (p_user_id, bid, btrim(p_name), em, p_phone, 'business_owner', 'active');
  update public.businesses set owner_id = p_user_id where id = bid;
  insert into public.licences (business_id, plan, start_date, expiry_date, status) values (bid, 'trial', today, today + greatest(p_trial_days, 1), 'active');
  perform private.log_event('register.succeeded', 'succeeded', null, bid, p_user_id, jsonb_build_object('ua', p_user_agent, 'trial_days', p_trial_days));
  return jsonb_build_object('ok', true, 'business_id', bid, 'business_no', bno);
end $$;

create function public.app_claim_invite(p_user_id uuid, p_email text, p_name text default null, p_phone text default null,
  p_ip text default null, p_request_id text default null, p_user_agent text default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv record; em text := lower(btrim(coalesce(p_email, '')));
begin
  perform private.set_context(p_user_id, 'service', 'edge:claim-profile', p_request_id, p_ip, 'Invite claimed', p_client_id);
  if exists (select 1 from public.users where id = p_user_id and deleted_at is null) then
    return jsonb_build_object('ok', true, 'code', 'already_claimed');
  end if;
  select * into inv from public.invites where lower(email) = em and deleted_at is null and claimed_at is null order by created_at limit 1;
  if not found then
    perform private.log_event('invite.claim', 'blocked', 'no_invite', null, p_user_id, null);
    return jsonb_build_object('ok', false, 'code', 'no_invite', 'message', 'No invite found for this email.');
  end if;
  insert into public.users (id, business_id, name, email, phone, role, status)
  values (p_user_id, inv.business_id, coalesce(nullif(btrim(inv.name), ''), nullif(btrim(p_name), ''), split_part(em, '@', 1)), em,
          coalesce(inv.phone, p_phone), inv.role, 'active');
  if inv.role = 'business_owner' then
    update public.businesses set owner_id = p_user_id where id = inv.business_id and owner_id is null;
  end if;
  update public.invites set claimed_at = now(), claimed_by = p_user_id where id = inv.id;
  perform private.log_event('invite.claim', 'succeeded', null, inv.business_id, p_user_id, jsonb_build_object('ua', p_user_agent));
  return jsonb_build_object('ok', true, 'business_id', inv.business_id, 'role', inv.role);
end $$;

create function public.app_create_invite(p_actor uuid, p_business_id uuid, p_email text, p_name text default null, p_phone text default null,
  p_role text default 'user', p_ip text default null, p_request_id text default null, p_user_agent text default null, p_client_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; em text := lower(btrim(coalesce(p_email, ''))); st jsonb; iid uuid;
begin
  perform private.set_context(p_actor, 'service', 'edge:enrol-user', p_request_id, p_ip, 'User enrolled', p_client_id);
  select id, role, business_id into a from public.users where id = p_actor and deleted_at is null and status = 'active';
  if not found then
    perform private.log_event('enrol.attempt', 'denied', 'no_profile', p_business_id, p_actor, null);
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Not allowed.');
  end if;
  st := private.access_state(p_actor);
  if a.role = 'super_admin' then null;
  elsif a.role = 'business_owner' and a.business_id = p_business_id and st->>'mode' = 'full' then null;
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
  if exists (select 1 from public.users where lower(email) = em and deleted_at is null) then
    perform private.log_event('enrol.attempt', 'blocked', 'already_user', p_business_id, p_actor, null);
    return jsonb_build_object('ok', false, 'code', 'already_user', 'message', 'That email is already registered.');
  end if;
  if exists (select 1 from public.invites where lower(email) = em and deleted_at is null and claimed_at is null) then
    return jsonb_build_object('ok', false, 'code', 'already_invited', 'message', 'That email already has an open invite.');
  end if;
  insert into public.invites (business_id, email, name, phone, role) values (p_business_id, em, nullif(btrim(p_name), ''), nullif(btrim(p_phone), ''), p_role) returning id into iid;
  perform private.log_event('enrol.created', 'succeeded', null, p_business_id, p_actor, jsonb_build_object('invite_id', iid));
  return jsonb_build_object('ok', true, 'invite_id', iid);
end $$;

select private.lock_api_functions();
