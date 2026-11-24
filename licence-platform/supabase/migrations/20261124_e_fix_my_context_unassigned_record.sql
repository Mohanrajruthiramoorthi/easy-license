-- Fix: my_context() raised 'record "b" is not assigned yet' for a signed-in person with no profile.
-- b is now always assigned (all nulls) before use.
create or replace function public.my_context()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare uid uuid := auth.uid(); u record; b record; st jsonb; mode text; recent boolean;
begin
  if uid is null then return jsonb_build_object('mode','blocked','reason','not_signed_in'); end if;
  select id, name, email, phone, role, status, business_id into u from public.users where id = uid and deleted_at is null;
  select id, business_no, name, owner_id into b from public.businesses where false;
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
end $function$;
select private.lock_api_functions();
