# Architecture Decision Log

## Approved

### ADL-007 — Cross-module workflow coordination
**Decision:** Synchronous orchestration + durable operation journal.
- Each module commits its own transaction.
- Orchestrator durably records workflow and step progress.
- Module calls use stable operation/idempotency identities.
- Retry resumes after process restart; distinguish transient/permanent failures.
- No broker is required initially.
- Cross-module work is not one automatically atomic transaction.
Journal schema, transaction boundaries, concurrency, retry schedules, and API contracts are Level 5 details. Consider an outbox only if a demonstrated reliability requirement cannot be met by the journal.

### ADL-001 — Identifier normalization and trial eligibility
**Normalization:** Email trim + lowercase for comparison; mobile E.164; no dot/plus-tag alias assumptions; preserve original verified values.

**Trial eligibility:** Balanced duplicate detection. Matching verified business identifiers trigger a duplicate-trial check. One matching contact detail alone is not automatic rejection. Ambiguous cases go to manual review.

**Retention:** Custom duration selected; exact duration remains open. Indefinite retention is not default. Define minimum data, restricted access, appeal, and privacy/legal review.

## Pending decisions
| ID | Topic | Status |
|---|---|---|
| ADL-002 | Entitlement override priority/tie-breaker | Pending |
| ADL-003 | Offline lease/grace defaults | Pending |
| ADL-004 | Device inactivity/capacity | Pending |
| ADL-005 | MFA/SMS recovery | Pending |
| ADL-006 | Privacy/legal retention detail | Pending |
| ADL-008 | Refund/partial refund/dispute/chargeback effects | Pending |
| ADL-009 | Subscription reinstatement/licence reissue after expiry | Pending |
| ADL-010 | Business ownership recovery | Pending |

Pending decisions must not silently become policy.
