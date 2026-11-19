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

### ADL-002 — Entitlement override and aggregation
**Status:** Approved for override behavior and aggregation model. Detailed conflict/tie-breaker rules remain a Level 5 design item.

**Administrative override:**
- An active explicit administrative override replaces the calculated value for that entitlement.
- Ordinary plan, add-on, complimentary, and other grants do not combine with the entitlement while that override is active.
- Mandatory security restrictions always take precedence over grants and overrides.
- Every override requires an authorized administrator, reason, scope, and validity period.
- On removal or expiry, the entitlement is recalculated from the remaining sources.
- Conflicting active administrative overrides must not be resolved arbitrarily; reject the conflict or require explicit resolution.

**Ordinary grant aggregation:**
- Aggregation is configured per entitlement; there is no single global aggregation rule.
- The configured strategy determines how applicable plan, add-on, complimentary, and other grants combine.
- Supported strategy vocabulary includes BOOLEAN_OR, BOOLEAN_AND, MAX, MIN, SUM, OVERRIDE, UNION, and INTERSECTION.
- Example: for `max_devices`, if its configured strategy is SUM, a plan grant of 5 plus add-on grants of 3 and 4 resolves to 12.
- The strategy and its valid value type must be defined for each entitlement. Do not apply SUM or another numeric strategy to an incompatible entitlement type.
- Deterministic precedence and tie-breakers for ordinary OVERRIDE sources still require detailed design.

### ADL-009 — Subscription repurchase after expiry
**Decision:** When an expired subscription is purchased again after its previous licence has expired, issue a **new licence ID**. Preserve the old licence and its terminal expiry history; do not reactivate or recycle its ID.

- The new purchase follows the normal payment confirmation → subscription activation → licence issuance → entitlement resolution workflow.
- The new licence has its own validity period and lifecycle history.
- The new licence may reference the prior subscription/licence lineage for audit and customer history.
- This decision applies to a new purchase after expiry; it does not define reinstatement during an active grace period or correction of an erroneous expiry. Those cases require their own rules.

### ADL-008 — Refund access policy
**Full refunds:** Make the access consequence configurable by consuming product or plan policy. Do not impose one universal revoke/suspend behavior across all products.
- A full refund is recorded as a separate financial event; the original successful payment record remains intact.
- The configured policy determines whether the associated licence is immediately revoked or suspended.
- Subscription status and entitlement recalculation follow the configured policy through the owning modules.
- Record refund amount, reason, actor where applicable, and timestamps.
- Refund processing uses the durable cross-module operation workflow and idempotency controls.

**Partial refunds:**
- A partial refund does not, by itself, suspend or revoke the associated licence; access remains active by default.
- If the partial refund explicitly removes a purchased add-on or entitlement, update that specific grant and recalculate entitlements through the Entitlement Engine.
- Preserve the original payment and record each partial refund as a separate financial event.
- The amount refunded must not be used as an implicit or automatic percentage-based entitlement reduction.

**Refund reversals/corrections:**
- A reversal or correction is recorded as a new financial event; do not delete or overwrite the original refund event.
- Restore or reinstate affected subscription/licence access only after the relevant payment state is confirmed.
- Recalculate affected entitlements through the Entitlement Engine.
- Apply changes through the durable cross-module operation workflow with idempotency and audit history.
- Do not automatically reactivate a revoked licence. If policy and the owning module permit access restoration, issue a new licence or use an explicitly defined reinstatement workflow; the exact rule remains to be designed.

**Still open:** precedence when product-level and plan-level full-refund policies conflict; behavior when no full-refund policy is configured; disputes and chargebacks. These must not be inferred from the approved rules.

## Pending decisions
| ID | Topic | Status |
|---|---|---|
| ADL-002 details | Ordinary OVERRIDE source precedence and tie-breakers | Pending Level 5 design |
| ADL-003 | Offline lease/grace defaults | Pending |
| ADL-004 | Device inactivity/capacity | Pending |
| ADL-005 | MFA/SMS recovery | Pending |
| ADL-006 | Privacy/legal retention detail | Pending |
| ADL-008 details | Full-refund policy precedence/default, disputes and chargebacks | Pending |
| ADL-010 | Business ownership recovery | Pending |

Pending decisions must not silently become policy.
