# Licence platform — context for Claude Code

Licence manager/tracker on Supabase. Three layers: app owner (`super_admin`) → business owner → users.
Read `docs/adl/ADL-033-supabase-phase1-licence-recording.md` first, then `README.md`.

## Where things are
- `supabase/migrations/` — DB (apply in order, A→E). `supabase/tests/foundation.sql` — SQL test suite (ends with `raise exception 'ALL TESTS PASSED (n checks)'`, i.e. it rolls back on purpose).
- `supabase/functions/{register,claim-profile,enrol-user}` — Deno Edge Functions (verify_jwt on, Google/OAuth only via JWT `amr`).
- `admin-dashboard/` — Vite + React 18 + TS dashboard, hash routing, IST dates. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (publishable key only).
- Supabase project ref: `qeiqtmxrjcweiysunkww`. Hosted on Vercel project `licence-desk` (root dir `licence-platform/admin-dashboard`). Branch: `supabase-licence-platform`.

## Rules that must not be broken
- NO hard deletes. Soft delete only (`deleted_at`); triggers block DELETE.
- Everything is audited: `audit_log` (data changes), `event_log` (attempts, denials, registrations). Denials are returned as results AND logged.
- Writes only via functions: `cmd_*` (authenticated, role checked inside) for the dashboard; `app_*` (service_role only) for Edge Functions. Tables are read-only to clients via RLS. After adding functions run `select private.lock_api_functions();`.
- Security-definer functions use `set search_path = ''` and fully qualified names.
- Audit context uses GUCs: `app.actor_id/actor_type/source/request_id/ip/reason/client_id`, `app.break_glass`.
- Access is derived, never stored: `access_state` = full | read_only | blocked + reason. Owner locked => whole business locked only. Admin can hold any licence.
- Holds/rollover: held days are added back to expiry (partial days round up, Asia/Kolkata). Uses `range_agg` for merged hold intervals. (Interpretation not yet confirmed by the product owner.)
- Payments come via API only; this app just records them. (Phase 2, not built.)
- Google-only sign-in. Lock-down of non-Google logins is pending until real Google sign-in is confirmed.

## Status
Phase 1 done (DB, holds/rollover, commands, Edge Functions, tests, dashboard). Pending: Supabase Auth Site URL/Redirect URLs + Google provider, payments API ledger (Phase 2), licence-check API (Phase 3), audit retention policy, consider making the repo private.

## Working style
- Check advisors after DB changes (`get_advisors` security + performance).
- Add a SQL test for every new rule; keep migrations additive (new file, never edit old ones).
- Commit messages: short, imperative.
