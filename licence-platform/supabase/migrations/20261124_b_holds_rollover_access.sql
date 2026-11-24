-- Migration B: holds, expiry rollover, access state, licence_overview, my_context (applied as phase1_b_holds_rollover_access)
create or replace function private.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; n jsonb; act text; cols text[]; k text; rid uuid; bid uuid;
  v_actor uuid; v_type text; v_role text; v_reason text; m text[];
begin
  if TG_OP = 'INSERT' then n := to_jsonb(NEW); act := 'insert';
  elsif TG_OP = 'UPDATE' then
    o := to_jsonb(OLD); n := to_jsonb(NEW);
    if o = n then return null; end if;
    cols := array(select key from jsonb_each(n) where o->key is distinct from n->key);
    act := case when o->>'deleted_at' is null and n->>'deleted_at' is not null then 'soft_delete'
                when o->>'deleted_at' is not null and n->>'deleted_at' is null then 'restore'
                else 'update' end;
  else o := to_jsonb(OLD); act := 'hard_delete'; end if;

  rid := (coalesce(n, o)->>'id')::uuid;
  bid := case TG_TABLE_NAME when 'businesses' then rid else (coalesce(n, o)->>'business_id')::uuid end;
  v_actor := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid());
  v_type := coalesce(nullif(current_setting('app.actor_type', true), ''), case when v_actor is not null then 'user' else 'system' end);
  if v_actor is not null then select role into v_role from public.users where id = v_actor; end if;
  v_reason := coalesce(nullif(current_setting('app.reason', true), ''), n->>'delete_reason', o->>'delete_reason', n->>'release_note');

  m := private.masked_columns(TG_TABLE_NAME);
  foreach k in array m loop
    if o is not null and o->>k is not null then o := jsonb_set(o, array[k], to_jsonb(left(o->>k,1) || '***')); end if;
    if n is not null and n->>k is not null then n := jsonb_set(n, array[k], to_jsonb(left(n->>k,1) || '***')); end if;
  end loop;

  insert into public.audit_log (actor_id, actor_type, actor_role, client_id, source, request_id, ip,
    table_name, row_id, business_id, action, changed_columns, old_row, new_row, reason)
  values (v_actor, v_type, v_role, nullif(current_setting('app.client_id', true), ''),
    coalesce(nullif(current_setting('app.source', true), ''), 'direct'),
    nullif(current_setting('app.request_id', true), ''), nullif(current_setting('app.ip', true), ''),
    TG_TABLE_NAME, rid, bid, act, cols, o, n, v_reason);
  return null;
end $$;

create table public.holds (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('licence','business','user')),
  target_id uuid not null,
  business_id uuid not null references public.businesses(id) on delete restrict,
  reason_code text not null check (reason_code in ('non_payment','policy','security','customer_request','investigation','other')),
  note text,
  rollover boolean not null default true,
  placed_by uuid, placed_at timestamptz not null default now(),
  release_at timestamptz,
  released_by uuid, released_at timestamptz, release_note text,
  constraint holds_release_at_chk check (release_at is null or release_at > placed_at),
  constraint holds_released_chk check (released_at is null or released_at >= placed_at)
);
create unique index holds_one_open_per_reason on public.holds (target_type, target_id, reason_code) where released_at is null;
create index holds_target_idx on public.holds (target_type, target_id);
create index holds_business_idx on public.holds (business_id);
alter table public.holds enable row level security;
create trigger holds_audit after insert or update or delete on public.holds for each row execute function private.audit_row();
create trigger holds_no_delete before delete on public.holds for each row execute function private.block_hard_delete();
create trigger holds_no_truncate before truncate on public.holds for each statement execute function private.block_log_change();
grant select on public.holds to authenticated, service_role;

create function private.licence_tz() returns text language sql immutable set search_path = '' as $$ select 'Asia/Kolkata' $$;

create function private.open_hold_exists(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.holds h where h.target_type = p_type and h.target_id = p_id
    and h.released_at is null and (h.release_at is null or h.release_at > now()))
$$;

-- Expiry with rollover: exclusive end instant, in licence timezone, rounded up to a date boundary
create function private.licence_valid_until(p_licence uuid) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  l record; tz text := private.licence_tz(); v_start timestamptz; v_end timestamptz;
  isl tstzrange; s timestamptz; e timestamptz; local_ts timestamp;
begin
  select li.start_date, li.expiry_date, li.business_id, b.owner_id into l
    from public.licences li join public.businesses b on b.id = li.business_id where li.id = p_licence;
  if not found then return null; end if;
  v_start := l.start_date::timestamp at time zone tz;
  v_end := (l.expiry_date + 1)::timestamp at time zone tz;
  for isl in
    select unnest(range_agg(tstzrange(h.placed_at,
             least(coalesce(h.released_at, 'infinity'::timestamptz), coalesce(h.release_at, 'infinity'::timestamptz), now()), '[)')))
      from public.holds h
     where h.rollover and (
           (h.target_type = 'licence' and h.target_id = p_licence)
        or (h.target_type = 'business' and h.target_id = l.business_id)
        or (h.target_type = 'user' and h.target_id = l.owner_id))
  loop
    s := greatest(lower(isl), v_start); e := upper(isl);
    if e <= s then continue; end if;
    if s >= v_end then exit; end if;
    v_end := v_end + (e - s);
  end loop;
  local_ts := v_end at time zone tz;
  if local_ts::time <> time '00:00' then local_ts := (local_ts::date + 1)::timestamp; end if;
  return local_ts at time zone tz;
end $$;

create function private.current_licence_id(p_business uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select li.id from public.licences li
   where li.business_id = p_business and li.deleted_at is null and li.status = 'active'
   order by private.licence_valid_until(li.id) desc nulls last limit 1
$$;

create function private.access_state(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u record; b record; lic uuid; vu timestamptz;
begin
  select id, role, status, business_id, deleted_at into u from public.users where id = p_user;
  if not found or u.deleted_at is not null then return jsonb_build_object('mode','blocked','reason','no_profile'); end if;
  if u.status <> 'active' then return jsonb_build_object('mode','blocked','reason','user_inactive'); end if;
  if u.role = 'super_admin' then return jsonb_build_object('mode','full','reason','ok'); end if;
  if private.open_hold_exists('user', u.id) then return jsonb_build_object('mode','blocked','reason','user_held'); end if;
  select id, owner_id, deleted_at into b from public.businesses where id = u.business_id;
  if not found or b.deleted_at is not null then return jsonb_build_object('mode','blocked','reason','business_deleted'); end if;
  if private.open_hold_exists('business', b.id) then return jsonb_build_object('mode','blocked','reason','business_held'); end if;
  if b.owner_id is not null and private.open_hold_exists('user', b.owner_id) then
    return jsonb_build_object('mode','blocked','reason','owner_held');
  end if;
  lic := private.current_licence_id(b.id);
  if lic is null then
    return jsonb_build_object('mode','read_only','reason',
      case when exists (select 1 from public.licences where business_id = b.id and deleted_at is null and status = 'pending')
           then 'licence_pending'
           when exists (select 1 from public.licences where business_id = b.id and deleted_at is null and status = 'revoked')
           then 'licence_revoked' else 'no_licence' end);
  end if;
  if private.open_hold_exists('licence', lic) then return jsonb_build_object('mode','blocked','reason','licence_held'); end if;
  vu := private.licence_valid_until(lic);
  if now() >= vu then return jsonb_build_object('mode','read_only','reason','licence_expired','licence_id',lic); end if;
  return jsonb_build_object('mode','full','reason','ok','licence_id',lic,'valid_until',vu);
end $$;

create function private.my_mode() returns text language sql stable security definer set search_path = '' as $$
  select private.access_state(auth.uid())->>'mode' $$;

create view public.licence_overview with (security_invoker = true) as
select l.id, l.business_id, l.start_date, l.expiry_date, l.plan, l.status, l.created_at, l.deleted_at,
  v.valid_until,
  case when v.valid_until is null then l.expiry_date else ((v.valid_until at time zone 'Asia/Kolkata')::date - 1) end as effective_expiry_date,
  case when v.valid_until is null then 0 else ((v.valid_until at time zone 'Asia/Kolkata')::date - 1) - l.expiry_date end as paused_days,
  private.open_hold_exists('licence', l.id) as is_held,
  case when l.deleted_at is not null then 'deleted'
       when l.status = 'revoked' then 'revoked'
       when l.status = 'pending' then 'pending'
       when private.open_hold_exists('licence', l.id) then 'held'
       when now() >= v.valid_until then 'expired'
       else 'active' end as state
from public.licences l
cross join lateral (select private.licence_valid_until(l.id) as valid_until) v;
grant select on public.licence_overview to authenticated;

create function public.my_context() returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); u record; b record; st jsonb; mode text; recent boolean;
begin
  if uid is null then return jsonb_build_object('mode','blocked','reason','not_signed_in'); end if;
  select id, name, email, phone, role, status, business_id into u from public.users where id = uid and deleted_at is null;
  st := private.access_state(uid);
  mode := st->>'mode';
  if u.id is not null and u.business_id is not null then
    select id, business_no, name, owner_id into b from public.businesses where id = u.business_id;
  end if;
  if mode = 'blocked' and st->>'reason' <> 'no_profile' then
    select exists (select 1 from public.event_log where event = 'access.denied' and user_id = uid
       and reason = st->>'reason' and at > now() - interval '1 hour') into recent;
    if not recent then
      perform private.log_event('access.denied', 'denied', st->>'reason', u.business_id, uid, null);
    end if;
  end if;
  return jsonb_build_object('mode', mode, 'reason', st->>'reason', 'valid_until', st->'valid_until',
    'profile', case when u.id is null then null else jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'phone',u.phone,'role',u.role,'status',u.status,'business_id',u.business_id) end,
    'business', case when b.id is null then null else jsonb_build_object('id',b.id,'business_no',b.business_no,'name',b.name) end);
end $$;

grant usage on schema private to authenticated, service_role;
grant execute on function private.licence_valid_until(uuid), private.open_hold_exists(text,uuid), private.my_mode() to authenticated;
select private.lock_api_functions();
