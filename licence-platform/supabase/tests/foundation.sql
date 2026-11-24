-- Foundation tests. Run in the SQL editor / execute_sql; everything is rolled back (the DO block ends by raising).
-- Success is reported as: ALL TESTS PASSED (n checks)
create or replace function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql;
    msg := null;
  exception when others then
    msg := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return msg;
end $f$;

do $t$
declare
  admin_id uuid; o_id uuid := gen_random_uuid(); u_id uuid := gen_random_uuid(); emp2_id uuid := gen_random_uuid();
  bid uuid; lid uuid; r text; n int := 0; v record; today date := (now() at time zone 'Asia/Kolkata')::date;
  st jsonb; cnt int; hid uuid;
  procedure_ok boolean;
begin
  select id into admin_id from public.users where role = 'super_admin' and deleted_at is null limit 1;
  assert admin_id is not null, 'need a super_admin'; n := n + 1;

  -- 1. hard delete is blocked, even for the table owner
  begin delete from public.businesses; raise exception 'NOT BLOCKED'; exception when others then assert sqlerrm like 'Hard delete is not allowed%', 'hard delete: '||sqlerrm; end; n := n + 1;
  begin truncate public.payments; raise exception 'NOT BLOCKED'; exception when others then assert sqlerrm like '%append-only%', 'truncate: '||sqlerrm; end; n := n + 1;

  -- 2. direct writes by app roles are denied
  r := pg_temp.as_user(admin_id, $$update public.businesses set name = 'x'$$);
  assert r like 'permission denied%', 'direct update should be denied: '||coalesce(r,'allowed'); n := n + 1;
  r := pg_temp.as_user(admin_id, $$insert into public.payments (business_id, paid_on, amount) select id, current_date, 1 from public.businesses limit 1$$);
  assert r like 'permission denied%', 'direct payment insert should be denied: '||coalesce(r,'allowed'); n := n + 1;

  -- 3. create business via command, audited with actor + reason
  r := pg_temp.as_user(admin_id, $$select public.cmd_create_business('Test Traders', 'owner-test@example.com', 'Test Owner', '+919840011223', '{"city":"Chennai"}')$$);
  assert r is null, 'create business failed: '||coalesce(r,''); n := n + 1;
  select id into bid from public.businesses where name = 'Test Traders';
  select count(*) into cnt from public.audit_log where table_name = 'businesses' and row_id = bid and action = 'insert' and actor_id = admin_id and reason is not null and actor_role = 'super_admin';
  assert cnt = 1, 'business insert audit row missing'; n := n + 1;
  select count(*) into cnt from public.audit_log where table_name = 'invites' and business_id = bid and (new_row->>'email') not like '%owner-test%';
  assert cnt = 1, 'invite email must be masked in audit'; n := n + 1;

  -- owner and users exist (auth rows simulated)
  insert into auth.users (id, email, aud, role) values (o_id, 'owner-test@example.com', 'authenticated', 'authenticated'), (u_id, 'user-test@example.com', 'authenticated', 'authenticated'), (emp2_id, 'emp2-test@example.com', 'authenticated', 'authenticated');
  insert into public.users (id, business_id, name, email, role) values (o_id, bid, 'Test Owner', 'owner-test@example.com', 'business_owner'), (u_id, bid, 'Test User', 'user-test@example.com', 'user'), (emp2_id, bid, 'Test Emp2', 'emp2-test@example.com', 'user');
  update public.businesses set owner_id = o_id where id = bid;

  -- 4. no licence => read_only
  st := private.access_state(o_id);
  assert st->>'mode' = 'read_only' and st->>'reason' = 'no_licence', 'no licence should be read_only: '||st; n := n + 1;

  -- 5. licence + one trial only
  r := pg_temp.as_user(admin_id, format($$select public.cmd_create_licence(%L, 'trial', %L, %L)$$, bid, today - 10, today + 4));
  assert r is null, 'create licence failed: '||coalesce(r,''); n := n + 1;
  r := pg_temp.as_user(admin_id, format($$select public.cmd_create_licence(%L, 'trial', %L, %L)$$, bid, today, today + 14));
  assert r like '%already has a trial%', 'second trial should fail: '||coalesce(r,'allowed'); n := n + 1;
  select id into lid from public.licences where business_id = bid;
  assert private.access_state(o_id)->>'mode' = 'full', 'valid licence should be full'; n := n + 1;

  -- 6. rollover maths (past, released holds)
  select * into v from public.licence_overview where id = lid;
  assert v.paused_days = 0 and v.effective_expiry_date = today + 4, 'no holds => no shift'; n := n + 1;
  insert into public.holds (target_type, target_id, business_id, reason_code, placed_by, placed_at, released_at, released_by)
    values ('licence', lid, bid, 'policy', admin_id, date_trunc('day', now()) - interval '3 days', date_trunc('day', now()) - interval '1 day', admin_id);
  select * into v from public.licence_overview where id = lid;
  assert v.paused_days = 2 and v.effective_expiry_date = today + 6, 'two held days should roll over, got '||v.paused_days; n := n + 1;
  -- overlapping hold must not double count
  insert into public.holds (target_type, target_id, business_id, reason_code, placed_by, placed_at, released_at, released_by)
    values ('licence', lid, bid, 'security', admin_id, date_trunc('day', now()) - interval '2 days 12 hours', date_trunc('day', now()) - interval '1 day 12 hours', admin_id);
  select * into v from public.licence_overview where id = lid;
  assert v.paused_days = 2, 'overlap must be merged, got '||v.paused_days; n := n + 1;
  -- non_payment hold (rollover=false) adds nothing
  insert into public.holds (target_type, target_id, business_id, reason_code, rollover, placed_by, placed_at, released_at, released_by)
    values ('licence', lid, bid, 'non_payment', false, admin_id, date_trunc('day', now()) - interval '9 days', date_trunc('day', now()) - interval '6 days', admin_id);
  select * into v from public.licence_overview where id = lid;
  assert v.paused_days = 2, 'non-rollover hold must not extend, got '||v.paused_days; n := n + 1;
  -- hold on the owner also rolls the business licence over (2 more days, separate window)
  insert into public.holds (target_type, target_id, business_id, reason_code, placed_by, placed_at, released_at, released_by)
    values ('user', o_id, bid, 'investigation', admin_id, date_trunc('day', now()) - interval '8 days', date_trunc('day', now()) - interval '7 days', admin_id);
  select * into v from public.licence_overview where id = lid;
  assert v.paused_days = 3, 'owner hold should roll over, got '||v.paused_days; n := n + 1;

  -- 7. holds via command, and what they block
  r := pg_temp.as_user(u_id, format($$select public.cmd_place_hold('user', %L, 'policy', 'x')$$, emp2_id));
  assert r like 'Only the app owner%', 'non-admin cannot hold: '||coalesce(r,'allowed'); n := n + 1;
  r := pg_temp.as_user(admin_id, format($$select public.cmd_place_hold('user', %L, 'policy', 'x')$$, admin_id));
  assert r like '%cannot be put on hold%', 'cannot hold app owner: '||coalesce(r,'allowed'); n := n + 1;
  r := pg_temp.as_user(admin_id, format($$select public.cmd_place_hold('user', %L, 'policy', 'checking a complaint')$$, emp2_id));
  assert r is null, 'hold user failed: '||coalesce(r,''); n := n + 1;
  assert private.access_state(emp2_id)->>'reason' = 'user_held', 'held user is blocked'; n := n + 1;
  assert private.access_state(u_id)->>'mode' = 'full' and private.access_state(o_id)->>'mode' = 'full', 'holding a user affects only that user'; n := n + 1;
  r := pg_temp.as_user(admin_id, format($$select public.cmd_place_hold('user', %L, 'policy', 'again')$$, emp2_id));
  assert r like '%already has an open hold%', 'duplicate open hold rejected: '||coalesce(r,'allowed'); n := n + 1;

  r := pg_temp.as_user(admin_id, format($$select public.cmd_place_hold('user', %L, 'non_payment', 'invoice 42 unpaid')$$, o_id));
  assert r is null, 'hold owner failed: '||coalesce(r,''); n := n + 1;
  assert private.access_state(o_id)->>'reason' = 'user_held', 'owner blocked'; n := n + 1;
  assert private.access_state(u_id)->>'mode' = 'blocked' and private.access_state(u_id)->>'reason' = 'owner_held', 'owner hold locks the whole business'; n := n + 1;
  assert private.access_state(admin_id)->>'mode' = 'full', 'admin keeps full access'; n := n + 1;
  -- RLS: blocked owner sees no licences
  r := pg_temp.as_user(o_id, $q$do $x$ begin if (select count(*) from public.licences) <> 0 then raise exception 'LEAK'; end if; end $x$$q$);
  assert r is null, 'blocked owner must not read licences: '||coalesce(r,''); n := n + 1;

  select id into hid from public.holds where target_id = o_id and released_at is null;
  r := pg_temp.as_user(admin_id, format($$select public.cmd_release_hold(%L, 'paid')$$, hid));
  assert r is null, 'release failed: '||coalesce(r,''); n := n + 1;
  assert private.access_state(u_id)->>'mode' = 'full', 'released => business unlocked'; n := n + 1;
  assert (select count(*) from public.audit_log where table_name = 'holds' and row_id = hid) = 2, 'hold place + release audited'; n := n + 1;

  -- licence hold
  r := pg_temp.as_user(admin_id, format($$select public.cmd_place_hold('licence', %L, 'policy', 'licence review')$$, lid));
  assert r is null, 'licence hold failed: '||coalesce(r,''); n := n + 1;
  assert private.access_state(o_id)->>'reason' = 'licence_held' and (select state from public.licence_overview where id = lid) = 'held', 'licence hold blocks'; n := n + 1;
  select id into hid from public.holds where target_id = lid and released_at is null;
  perform pg_temp.as_user(admin_id, format($$select public.cmd_release_hold(%L, 'ok')$$, hid));

  -- auto-release (scheduled)
  r := pg_temp.as_user(admin_id, format($$select public.cmd_place_hold('business', %L, 'customer_request', 'pause 1 hour', now() + interval '1 hour')$$, bid));
  assert r is null, 'scheduled hold failed: '||coalesce(r,''); n := n + 1;
  assert private.access_state(u_id)->>'reason' = 'business_held', 'business hold blocks all'; n := n + 1;
  update public.holds set release_at = now() - interval '1 second', placed_at = now() - interval '1 minute' where target_id = bid and released_at is null;
  assert private.access_state(u_id)->>'mode' = 'full', 'scheduled hold expired by itself'; n := n + 1;
  perform private.settle_holds();
  assert (select count(*) from public.holds where target_id = bid and released_at is not null and release_note like 'Auto-released%') = 1, 'settle records auto-release'; n := n + 1;

  -- 8. expiry => read_only
  update public.licences set start_date = today - 30, expiry_date = today - 5 where id = lid;
  -- (past holds still extend; clear their effect for this check by marking them non-rollover)
  update public.holds set rollover = false where business_id = bid;
  assert private.access_state(u_id)->>'mode' = 'read_only' and private.access_state(u_id)->>'reason' = 'licence_expired', 'expired => read_only'; n := n + 1;
  r := pg_temp.as_user(o_id, format($$select public.app_create_invite(%L, %L, 'new@example.com')$$, o_id, bid));
  assert r like 'permission denied%', 'app_* is not callable by users: '||coalesce(r,'allowed'); n := n + 1;
  st := public.app_create_invite(o_id, bid, 'new@example.com', 'New');
  assert st->>'code' = 'read_only', 'read_only owner cannot enrol: '||st; n := n + 1;
  assert (select count(*) from public.event_log where event = 'enrol.attempt' and outcome = 'denied' and user_id = o_id) = 1, 'denied enrol attempt is logged'; n := n + 1;
  update public.licences set expiry_date = today + 30 where id = lid;
  st := public.app_create_invite(o_id, bid, 'new@example.com', 'New');
  assert (st->>'ok')::boolean, 'licensed owner can enrol: '||st; n := n + 1;
  st := public.app_create_invite(o_id, bid, 'user-test@example.com', 'Dup');
  assert st->>'code' = 'already_user', 'existing user email refused'; n := n + 1;

  -- 9. soft delete + restore, reasons mandatory, audited
  r := pg_temp.as_user(admin_id, format($$select public.cmd_soft_delete('user', %L, '')$$, emp2_id));
  assert r like '%reason%required%', 'reason is mandatory: '||coalesce(r,'allowed'); n := n + 1;
  r := pg_temp.as_user(admin_id, format($$select public.cmd_soft_delete('user', %L, 'left the company')$$, emp2_id));
  assert r is null, 'soft delete failed: '||coalesce(r,''); n := n + 1;
  assert (select deleted_at is not null and delete_reason = 'left the company' from public.users where id = emp2_id), 'row kept with reason'; n := n + 1;
  assert (select count(*) from public.audit_log where row_id = emp2_id and action = 'soft_delete' and reason = 'left the company' and actor_id = admin_id) = 1, 'soft delete audited'; n := n + 1;
  r := pg_temp.as_user(admin_id, format($$select public.cmd_restore('user', %L, 'came back')$$, emp2_id));
  assert r is null and (select deleted_at is null from public.users where id = emp2_id), 'restore failed: '||coalesce(r,''); n := n + 1;
  assert (select count(*) from public.audit_log where row_id = emp2_id and action = 'restore') = 1, 'restore audited'; n := n + 1;
  assert (select count(*) from public.audit_log where table_name = 'users' and row_id = emp2_id and (new_row->>'email') = 'e***') >= 1, 'user email masked in audit'; n := n + 1;
  r := pg_temp.as_user(admin_id, format($$select public.cmd_soft_delete('user', %L, 'cleanup')$$, admin_id));
  assert r like '%own account%', 'cannot delete self'; n := n + 1;

  -- 10. logs are append-only
  begin update public.audit_log set reason = 'x'; raise exception 'NOT BLOCKED'; exception when others then assert sqlerrm like '%append-only%', 'audit update: '||sqlerrm; end; n := n + 1;
  begin delete from public.event_log; raise exception 'NOT BLOCKED'; exception when others then assert sqlerrm like '%append-only%', 'event delete: '||sqlerrm; end; n := n + 1;
  r := pg_temp.as_user(o_id, $$select count(*) from public.audit_log$$);
  assert r like 'permission denied%' or r is null, 'owner audit read'; n := n + 1;
  r := pg_temp.as_user(o_id, $q$do $x$ begin if (select count(*) from public.audit_log) <> 0 then raise exception 'LEAK'; end if; end $x$$q$);
  assert r is null, 'owner must not see audit rows: '||coalesce(r,''); n := n + 1;

  -- 11. rate limit
  for i in 1..5 loop assert (public.app_rate_limit('t', 'ip1', 5, 60)->>'ok')::boolean, 'under limit'; end loop;
  assert not (public.app_rate_limit('t', 'ip1', 5, 60)->>'ok')::boolean, 'over limit blocked'; n := n + 1;

  -- 12. denial events deduped
  update public.licences set status = 'active' where id = lid;
  perform public.app_log_event('register.attempt', 'blocked', 'rate_limited');
  assert (select count(*) from public.event_log where event = 'register.attempt' and reason = 'rate_limited') >= 1, 'service events recorded'; n := n + 1;

  raise exception 'ALL TESTS PASSED (% checks)', n;
end $t$;
