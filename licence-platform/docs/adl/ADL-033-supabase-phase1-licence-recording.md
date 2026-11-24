# ADL-033: Supabase for Phase 1; licence recording rules

Status: accepted (supersedes ADL-032 for Phase 1)
Date: 2026-11-24

## Context
Licence Desk is a licence manager and tracker. It records businesses, users, trial and paid licences and payments.
Customer apps do the actual work (including taking payments). Licence Desk records the data.

## Decisions
1. **Platform:** Supabase (Postgres, Auth with Google only, Edge Functions) for Phase 1.
2. **Rollover:** days a licence spends on hold are added back to its expiry. Overlapping holds are merged so no day counts twice.
   Holds with `rollover = false` (default for `non_payment`) do not extend. Partial days round up to the end of the date. Dates use Asia/Kolkata.
3. **Owner lock:** holding the business owner locks the whole business. Holding a normal user blocks only that user.
   Holds can also target a licence or the whole business. The app owner (super_admin) cannot be held and keeps full access.
4. **Payments are recorded, not processed.** They arrive only through an API called by the customer's own app (Phase 2).
   The dashboard shows payments read-only and cannot create them. Direct table writes are disabled for every app role.
5. **No hard deletes.** Every table is soft delete (`deleted_at`, `deleted_by`, `delete_reason`, reason required). Foreign keys are `ON DELETE RESTRICT`.
   A trigger blocks `DELETE` and `TRUNCATE`; the only bypass is the `app.break_glass` setting, used by hand and itself audited.
6. **Audit:** `audit_log` (every data change: who, role, source, request id, IP, reason, old and new row, PII masked) and `event_log`
   (attempts and outcomes: registration, enrolment, access denied, internal errors, including refusals). Both are append-only.
   Rate limiting lives in its own table `rate_limit_hits` so operational data never mixes with the audit trail.
7. **Write path:** all writes go through database functions. `cmd_*` for the dashboard (authenticated users, permission checked inside),
   `app_*` for Edge Functions (service_role only). Service-function denials are returned as results and logged, not thrown.
8. **Access modes:** `full`, `read_only` (no live licence, expired, pending, revoked), `blocked` (holds, inactive, deleted). Derived at read time, never stored.

## Open items
- Retention period for audit and event logs (currently kept forever).
- Phase 2: licence model (products, plans, renewals, overlap rules), payments ledger with API clients, keys and idempotency.
- Phase 3: licence-check API with signed tokens and devices.
