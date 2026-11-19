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
| Roles & Access Policy | Generic roles, policy definitions and assignments |
| Subscription Management | Plans, subscription lifecycle, renewals, cancellation |
| Payment Management | Payment attempts, settlement, refunds, disputes, chargebacks |
| Licence Engine | Licence issuance, validity, suspension, expiry, revocation |
| Entitlement Engine | Entitlement sources, aggregation, precedence and resolved profiles |
| Device Management | Registration, binding, capacity, replacement and revocation |
| Product Configuration Registry | Consuming product registration and configuration |
| Audit & Security | Security events and administrative audit trail |
| Integration API | External contracts, routing, middleware, validation, limits, versioning |
| Admin Operations | Authorized administrative use cases and orchestration |
| Notifications | Templates, preferences, delivery, retries and history |
| Recovery & Reconciliation | Durable operation journal and consistency recovery |

## Critical domain boundaries
Payment success does not directly activate a licence. Payment Management records the confirmed result; Subscription Management applies commercial state; Licence Engine issues/updates the licence; Entitlement Engine resolves access.

Refunds, disputes, chargebacks, and settlement are separate financial facts. Do not overwrite the original successful payment.

Licence Engine owns licence transitions. Entitlement Engine owns entitlement resolution. Product-specific feature implementation and resource-level business permissions remain in the consuming product.

Source modules request notifications through the Notifications interface; they do not call providers directly. Provider acceptance is not proof of delivery, and delivery failure does not roll back business operations.

Admin Operations invokes owning module interfaces. No direct administrative table edits. Privileged actions require actor, reason, authorization, and audit history.

## Prohibited coupling
- Direct cross-module writes.
- Consuming-product database access.
- Provider-specific notification calls from business modules.
- Conflating payment, subscription, licence, and entitlement states.
- Implementing consuming-product features inside Easy License.
