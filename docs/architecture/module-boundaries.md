# Module Boundaries

## Invariants
- Each module owns its business rules and persisted data.
- Cross-module calls use explicit service interfaces.
- No direct cross-module table writes.
- Persistence entities and repositories are not public contracts.
- Application orchestration coordinates multi-module workflows.
- Retried operations use stable operation identities.

| Module | Responsibility |
|---|---|
| Identity & Authentication | Accounts, credentials, login, sessions |
| Business & Membership | Businesses, ownership, membership lifecycle |
| Basic Access Metadata (optional) | Only generic access metadata explicitly required by the integration contract; application permissions remain in the consuming application |
| Subscription/Licence Records | Store subscription references and validity information needed to manage licence records; no payment-driven automation |
| Payment Information Records | Store externally supplied payment details for reference/audit only; no collection, processing, verification, settlement, refund, dispute, chargeback, or gateway integration |
| Licence Engine | Licence issuance, validity, suspension, expiry, revocation |
| Entitlement Registry | Store application-scoped entitlement codes, types/metadata, and values; no application-specific feature semantics or enforcement |
| Device Management | Registration, binding, capacity, replacement and revocation |
| Product Configuration Registry | Consuming product registration and configuration |
| Audit & Security | Security events and administrative audit trail |
| Licence Validation API | External licence/device validation and generic entitlement retrieval contracts |
| Basic Administration | Manage accounts/businesses, products, subscriptions, licences, devices, and generic entitlement records |
| Audit History | Basic security and administrative activity history |
| Lifecycle Jobs | Minimal scheduled expiry and cleanup/reconciliation tasks required by the licence registry |

## Critical domain boundaries
Payment information is stored as externally supplied reference data only. Easy License does not verify payment or infer that funds were received. A payment record never automatically activates or changes a licence; licence lifecycle changes are explicit operations.

Payment gateway processing, settlement, refunds, disputes, and chargebacks are outside the current scope. Do not store payment authentication secrets such as card security codes, UPI PINs, or banking credentials.

Licence management owns the basic licence lifecycle. Easy License stores application-defined entitlement identifiers and values but does not own their feature semantics, application roles, business workflows, or enforcement. The consuming application interprets and enforces its own configuration.

Admin Operations invokes owning module interfaces. No direct administrative table edits. Privileged actions require actor, reason, authorization, and audit history.

## Prohibited coupling
- Direct cross-module writes.
- Consuming-product database access.
- Conflating payment, subscription, licence, and entitlement states.
- Implementing consuming-product features inside Easy License.
