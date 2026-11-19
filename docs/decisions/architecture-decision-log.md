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

**Disputes and chargebacks:**
- When a payment dispute is opened, apply a configurable policy; the recommended default is temporary suspension of the associated licence while the dispute is unresolved.
- If the dispute is won, restore eligible access only after the outcome/payment state is confirmed, using a controlled reinstatement workflow. Do not automatically reactivate a revoked licence.
- If the dispute is lost or a chargeback is confirmed, apply the configured revocation policy.
- Record dispute/chargeback outcomes as separate immutable financial events and coordinate subscription/licence/entitlement changes through the durable operation workflow.

**Still open:** precedence when product-level and plan-level full-refund policies conflict; behavior when no full-refund policy is configured; exact policy precedence/defaults for disputes and chargebacks. These must not be inferred from the approved rules.

### ADL-003 — Offline licence lease
**Decision:** Use a cryptographically signed offline licence lease with a 72-hour validity period. The consuming product can validate the signed lease locally during this period without contacting Easy License.

- The lease must be signed by Easy License and verified by the consuming product using a trusted verification key.
- Offline validation is limited to the signed licence/entitlement snapshot and its stated validity; it cannot authorize server-side operations.
- The lease must not be treated as an extension of the underlying subscription or licence validity.
- Grace period: 7 additional days after the 72-hour lease expires by default. A product/plan policy may configure a shorter or longer grace period, but never more than 30 days. The exact configuration model is a Level 5 detail.
- The 72-hour lease and any grace period govern only the consuming product's permitted offline behavior. Neither extends the underlying subscription or licence validity.
- During grace, the consuming product may continue limited offline access under its configured offline policy; it must reconnect to Easy License to obtain a renewed lease. Grace does not extend the underlying subscription or licence validity.
- Clock rollback/tamper handling, renewal protocol, precise restrictions on grace-mode capabilities, and revocation delay remain Level 5 design details.
- Offline access has an inherent revocation delay while the client is disconnected; this limitation must be explicit to consuming products.

### ADL-004 — Device inactivity and capacity
**Inactivity and reactivation:**
- A device is automatically marked inactive after 90 consecutive days without successful contact with Easy License.
- Inactivity does not delete the device record or its history and does not itself revoke a licence.
- Reactivation requires the device to authenticate with Easy License again and complete device verification.
- A local offline lease alone cannot reactivate an inactive device.
- Reactivation is subject to current account, business membership, licence, entitlement, and device-capacity checks.

**Capacity enforcement:**
- A new device registration that would exceed the configured active-device entitlement is rejected by default.
- The consuming product or its user must use an explicit device-replacement flow to deactivate an existing device before registering the replacement.
- Replacement must be an explicit, authorized operation; do not silently deactivate another device or temporarily exceed the limit.
- Preserve the replaced device's history and audit the replacement action.
- Exact replacement authorization, offline-device handling, and verification protocol remain Level 5 design details.

### ADL-005 — Administrative MFA and recovery
**Decision:** Use TOTP from an authenticator application as the primary MFA method for administrators, with one-time recovery codes as the backup mechanism. SMS may be offered only as a weaker fallback and is not equivalent to TOTP for privileged actions.

- Administrative accounts must have MFA enabled.
- Recovery codes are one-time use and must be stored server-side only as secure hashes.
- A used recovery code cannot be reused; generating a new set invalidates the previous set.
- SMS fallback must not silently satisfy stronger MFA requirements for sensitive or high-risk administrative actions.
- MFA reset and account recovery require a controlled, auditable verification process.
- Record enrollment, challenge, recovery, reset, and factor replacement security events without logging secrets or OTP values.
- Exact step-up authentication rules, recovery evidence, lockout/rate limits, and emergency break-glass procedures remain Level 5 design details.

### ADL-006 — Data retention and privacy framework
**Decision:** Define retention separately for each data category; do not apply one universal retention duration to all platform data.

- **Financial records:** Retain according to applicable legal, tax, accounting, and regulatory requirements.
- **Security audit records:** Define and enforce a documented security-retention period appropriate to investigation and compliance needs.
- **Device records:** Preserve expired, inactive, replaced, and revoked device history for audit purposes, subject to a defined retention policy.
- **Personal data:** Apply data minimization; delete or anonymize personal data when it is no longer required for a legitimate purpose or applicable retention obligation.
- Retention and deletion rules must account for legal holds, disputes, investigations, and required record preservation.
- Access to retained data must be restricted by role and purpose; retention does not imply unrestricted operational access.
- Define retention periods, deletion/anonymization procedures, legal-hold handling, and exceptions through a documented data-category schedule after jurisdiction-specific legal review.
- Exact durations and implementation details remain pending; this decision does not authorize indefinite retention by default.

### ADL-010 — Business ownership recovery
**Decision:** Business ownership recovery requires verification of the requester's identity and evidence that the requester is authorized to control the business. Do not transfer ownership solely on the basis of a request or access to a single contact channel.

- Verify the requester's identity using an established, documented process.
- Assess evidence of authority over the business; the evidence standard must be appropriate to the business type and risk.
- Route high-risk, conflicting, or disputed claims to manual review.
- Preserve the existing ownership assignment until the recovery request is approved.
- Record the request, evidence references, verification steps, decision, approving actor, timestamps, and resulting ownership change in the audit history.
- Notify relevant parties of the request and outcome where appropriate, without disclosing sensitive evidence.
- Do not bypass existing security controls or use recovery as an informal ownership-transfer mechanism.
- Exact evidence requirements, review/appeal process, notification rules, and exceptional-case handling remain policy and Level 5 design details.

### ADL-011 — Application-owned entitlement definitions
**Decision:** Consuming applications define and own their entitlement codes, data types, meanings, and enforcement behavior. Easy License stores and serves generic entitlement identifiers and values without owning application-specific feature semantics.

- A consuming application may register entitlement definitions or metadata with Easy License for validation and administration.
- Easy License treats entitlement codes and values as application-scoped data; it does not implement the corresponding features or decide their product-specific behavior.
- Easy License may perform basic generic checks, such as licence validity, entitlement presence, value retrieval, and configured device-capacity enforcement.
- The consuming application remains responsible for interpreting entitlement values and enforcing feature behavior, application roles, workflows, and application-specific offline rules.
- Entitlement identifiers must be namespaced or scoped to the registered consuming application to prevent collisions.
- A consuming application remains authoritative for its feature catalogue and may change its definitions without requiring Easy License to understand those features.
- Exact registration schema, type system, validation contract, and versioning are Level 5 API design details.

### ADL-012 — Payment information recordkeeping only
**Decision:** Easy License stores payment details as records for reference and audit, but does not process, collect, initiate, verify, settle, refund, or otherwise handle payments.

- Store payment information supplied by an authorized consuming application or administrator, such as amount, currency, payment method/type, external transaction/reference ID, reported status, payment date/time, and optional receipt/reference metadata.
- Treat recorded payment status and references as externally supplied information; Easy License does not independently confirm that funds were received.
- Payment records do not automatically activate, extend, suspend, or revoke a licence. Licence lifecycle changes are explicit operations performed through the licence-management capability.
- Do not store card numbers, CVV, bank login credentials, UPI PINs, passwords, or other payment authentication secrets.
- Payment gateway integrations, checkout, collection, settlement, refunds, disputes, chargebacks, and payment reconciliation are outside the platform's current scope.
- Exact record schema, allowed status vocabulary, provenance, and API permissions are Level 5 design details.

### ADL-013 — Licence creation channels
**Decision:** Support both administrator-initiated licence creation and authorized consuming-application API requests for licence creation. Both channels use the same licence records, validation rules, lifecycle, and audit requirements.

- Administrators may create licences through authorized administrative operations.
- Registered and authorized consuming applications may request licence creation through the versioned Integration API.
- API requests must be authenticated, authorized, validated, and protected against duplicate/replayed operations using stable idempotency identities.
- The caller and creation channel must be recorded for audit.
- Neither channel may bypass licence validity, status, device, or entitlement constraints.
- Licence creation does not require Easy License to process or verify payment; any payment information is reference data only.
- Exact API contract, authorization scopes, required fields, and approval controls are Level 5 design details.

### ADL-014 — Licence ownership and product association
**Decision:** Every licence belongs to exactly one business and is associated with exactly one registered consuming product.

- A business may hold multiple licences.
- A business may hold licences for different registered consuming products.
- A licence cannot be shared across businesses or consuming products.
- The business and product association are established at licence creation and remain part of the licence's identity/history.
- Any transfer or reassignment must not be an implicit update; transfer rules, if required, need a separately authorized and audited workflow.
- Licence validation must check the exact business and product association supplied by the authenticated caller.
- Exact API fields and transfer policy are Level 5 design details.

### ADL-015 — Licence validity and expiry
**Decision:** Support time-bounded licences with explicit start and expiry timestamps, lifetime licences without an expiry timestamp, and authorized manual validity extensions.

- A time-bounded licence has a start timestamp and an expiry timestamp.
- A lifetime licence has no expiry timestamp and is not automatically expired by time.
- An authorized administrator may extend a licence's expiry with a recorded reason and audit history.
- Licence validity is evaluated at authorization/validation time; expiry must take effect based on the timestamp even if a scheduled expiry job has not run.
- Scheduled jobs may update stored lifecycle status and perform housekeeping, but they are not the authority for deciding whether a licence is currently valid.
- Exact timestamp semantics, timezone representation, boundary inclusivity, and extension constraints are Level 5 design details.

### ADL-016 — Licence lifecycle statuses
**Decision:** Use the basic licence statuses PENDING, ACTIVE, SUSPENDED, EXPIRED, and REVOKED.

- **PENDING:** Licence record has been created but is not yet active.
- **ACTIVE:** Licence is active and may be valid subject to its validity period and other validation checks.
- **SUSPENDED:** Licence is temporarily disabled; an authorized operation may reinstate it if it remains eligible.
- **EXPIRED:** Licence validity has ended. Expiry is determined by the validity timestamps, not by whether a scheduled job has updated the stored status.
- **REVOKED:** Licence is permanently disabled and cannot be reactivated. Any future grant requires a new licence record.
- Lifecycle transitions must be performed through authorized licence-management operations and recorded in audit history.
- Exact transition matrix, eligibility checks, and API representation are Level 5 design details.

## Pending decisions
| ID | Topic | Status |
|---|---|---|
| ADL-002 details | Ordinary OVERRIDE source precedence and tie-breakers | Pending Level 5 design |
| ADL-003 details | Clock rollback, renewal protocol, grace-mode capability restrictions and revocation behavior | Pending Level 5 design |
| ADL-004 details | Replacement authorization, offline-device handling and verification protocol | Pending Level 5 design |
| ADL-005 details | Step-up rules, recovery verification, lockout/rate limits and break-glass procedure | Pending Level 5 design |
| ADL-006 details | Per-category durations, deletion/anonymization schedule, legal holds and jurisdictional review | Pending Level 5/policy detail |
| ADL-008 details | Full-refund policy precedence/default and dispute/chargeback policy precedence/default | Pending |
| ADL-010 details | Evidence standards, review/appeal process, notifications and exceptional-case handling | Pending policy/Level 5 detail |

Pending decisions must not silently become policy.
