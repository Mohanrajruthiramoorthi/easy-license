-- Migration A: soft delete, no cascades, audit + event logs, rate-limit split, privilege lockdown (applied as phase1_a_foundation_softdelete_audit)
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname='public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
drop trigger if exists guard_business_update on public.businesses;
drop trigger if exists guard_user_update on public.users;
drop function if exists private.guard_business_update();
drop function if exists private.guard_user_update();
drop function if exists public.register_business(uuid,text,text,text,text,integer);
drop function if exists public.check_register_rate(text,integer,integer);

update public.licences set status='active' where status in ('expired','suspended');
alter table public.licences drop constraint licences_status_check;
alter table public.licences add constraint licences_status_check check (status in ('pending','active','revoked'));
alter table public.businesses drop column status;

do $$ declare t text; begin
  foreach t in array array['businesses','users','licences','payments','invites'] loop
    execute format('alter table public.%I add column deleted_at timestamptz, add column deleted_by uuid, add column delete_reason text', t);
    execute format('alter table public.%I add constraint %I check (deleted_at is null or char_length(btrim(coalesce(delete_reason,''''))) >= 3)', t, t||'_delete_reason_chk');
  end loop;
end $$;
alter table public.invites add column claimed_at timestamptz, add column claimed_by uuid;

alter table public.businesses drop constraint businesses_owner_fk, add constraint businesses_owner_fk foreign key (owner_id) references public.users(id) on delete restrict;
alter table public.invites drop constraint invites_business_id_fkey, add constraint invites_business_id_fkey foreign key (business_id) references public.businesses(id) on delete restrict;
alter table public.licences drop constraint licences_business_id_fkey, add constraint licences_business_id_fkey foreign key (business_id) references public.businesses(id) on delete restrict;
alter table public.payments drop constraint payments_business_id_fkey, add constraint payments_business_id_fkey foreign key (business_id) references public.businesses(id) on delete restrict;
alter table public.users drop constraint users_business_id_fkey, add constraint users_business_id_fkey foreign key (business_id) references public.businesses(id) on delete restrict;
alter table public.users drop constraint users_id_fkey, add constraint users_id_fkey foreign key (id) references auth.users(id) on delete restrict;

drop index public.businesses_gstin_key;
create unique index businesses_gstin_live_key on public.businesses (gstin) where gstin is not null and deleted_at is null;
alter table public.invites drop constraint invites_email_key;
create unique index invites_open_email_key on public.invites (email) where deleted_at is null and claimed_at is null;

alter table public.register_attempts rename to rate_limit_hits;
alter table public.rate_limit_hits rename column ip to key;
alter table public.rate_limit_hits rename column attempted_at to at;
alter table public.rate_limit_hits add column bucket text not null default 'register';
drop index public.register_attempts_ip_time_idx;
create index rate_limit_hits_lookup_idx on public.rate_limit_hits (bucket, key, at desc);
alter table public.rate_limit_hits enable row level security;

create function public.app_rate_limit(p_bucket text, p_key text, p_limit int, p_window_minutes int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from public.rate_limit_hits
   where bucket = p_bucket and key = p_key and at > now() - make_interval(mins => p_window_minutes);
  insert into public.rate_limit_hits (bucket, key) values (p_bucket, p_key);
  if n >= p_limit then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'message', 'Too many attempts. Try again later.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid, actor_type text not null check (actor_type in ('user','service','system')),
  actor_role text, client_id text, source text not null, request_id text, ip text,
  table_name text not null, row_id uuid, business_id uuid,
  action text not null check (action in ('insert','update','soft_delete','restore','hard_delete')),
  changed_columns text[], old_row jsonb, new_row jsonb, reason text
);
create index audit_log_row_idx on public.audit_log (table_name, row_id, at desc);
create index audit_log_business_idx on public.audit_log (business_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.event_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  event text not null,
  outcome text not null check (outcome in ('succeeded','failed','blocked','denied','info')),
  reason text, business_id uuid, user_id uuid, actor_id uuid, actor_type text, client_id text,
  ip text, user_agent text, request_id text, detail jsonb
);
create index event_log_at_idx on public.event_log (at desc);
create index event_log_business_idx on public.event_log (business_id, at desc);
create index event_log_event_idx on public.event_log (event, at desc);
alter table public.audit_log enable row level security;
alter table public.event_log enable row level security;

create function private.block_log_change() returns trigger language plpgsql as $$
begin raise exception 'Log tables are append-only' using errcode = '42501'; end $$;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function private.block_log_change();
create trigger event_log_immutable before update or delete on public.event_log for each row execute function private.block_log_change();
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function private.block_log_change();
create trigger event_log_no_truncate before truncate on public.event_log for each statement execute function private.block_log_change();

create function private.masked_columns(t text) returns text[] language sql immutable set search_path = '' as $$
  select case t
    when 'users' then array['name','email','phone']
    when 'invites' then array['name','email','phone']
    when 'businesses' then array['phone','email','address_line']
    else array[]::text[] end $$;

-- (audit_row is replaced in migration B to handle tables without deleted_at)
create function private.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
begin return null; end $$;

create function private.block_hard_delete() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.break_glass', true), '') = 'on' then
    return coalesce(OLD, NULL);
  end if;
  raise exception 'Hard delete is not allowed on %. Use soft delete.', TG_TABLE_NAME using errcode = '42501';
end $$;

do $$ declare t text; begin
  foreach t in array array['businesses','users','licences','payments','invites'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()', t||'_audit', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.block_hard_delete()', t||'_no_delete', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.block_log_change()', t||'_no_truncate', t);
  end loop;
end $$;

create function private.set_context(p_actor uuid, p_actor_type text, p_source text, p_request_id text, p_ip text, p_reason text, p_client_id text default null)
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('app.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('app.actor_type', coalesce(p_actor_type, ''), true);
  perform set_config('app.source', coalesce(p_source, ''), true);
  perform set_config('app.request_id', coalesce(p_request_id, ''), true);
  perform set_config('app.ip', coalesce(p_ip, ''), true);
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  perform set_config('app.client_id', coalesce(p_client_id, ''), true);
end $$;

create function private.begin_command(p_reason text default null) returns void language plpgsql set search_path = '' as $$
declare h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  perform private.set_context(auth.uid(), 'user', 'dashboard', h->>'x-request-id',
    btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), p_reason);
end $$;

create function private.log_event(p_event text, p_outcome text, p_reason text, p_business_id uuid, p_user_id uuid, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_log (event, outcome, reason, business_id, user_id, actor_id, actor_type, client_id, ip, request_id, detail)
  values (p_event, p_outcome, p_reason, p_business_id, p_user_id,
    coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid()),
    nullif(current_setting('app.actor_type', true), ''), nullif(current_setting('app.client_id', true), ''),
    nullif(current_setting('app.ip', true), ''), nullif(current_setting('app.request_id', true), ''), p_detail);
end $$;

create function public.app_log_event(p_event text, p_outcome text, p_reason text default null, p_business_id uuid default null,
  p_user_id uuid default null, p_actor_id uuid default null, p_ip text default null, p_user_agent text default null,
  p_request_id text default null, p_detail jsonb default null, p_client_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_log (event, outcome, reason, business_id, user_id, actor_id, actor_type, client_id, ip, user_agent, request_id, detail)
  values (p_event, p_outcome, p_reason, p_business_id, p_user_id, p_actor_id, 'service', p_client_id, p_ip, p_user_agent, p_request_id, p_detail);
  return jsonb_build_object('ok', true);
end $$;

create function private.lock_api_functions() returns void language plpgsql set search_path = '' as $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname like 'app\_%' then execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname like 'cmd\_%' or r.proname = 'my_context' then execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
revoke all on function private.lock_api_functions() from public, anon, authenticated, service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated, service_role;
grant select on public.businesses, public.users, public.licences, public.payments, public.invites to authenticated, service_role;
grant select on public.audit_log, public.event_log to authenticated;
select private.lock_api_functions();
