# Business Workflow Index

The Level 4 workflow specification covers:

| Section | Workflow |
|---|---|
| 4.1 | Registration and initial activation |
| 4.2 | Login and session lifecycle |
| 4.3 | Business and member management |
| 4.4 | Subscription and payment lifecycle |
| 4.5 | Licence lifecycle |
| 4.6 | Entitlement resolution |
| 4.7 | Device lifecycle and security |
| 4.8 | Access authorization and validation |
| 4.9 | Admin operations |
| 4.10 | Notifications |
| 4.11 | Failure recovery and reconciliation |

This index is not a replacement for the full Level 4 specification. Add the complete approved source document and record its exact version/approval state before treating it as repository baseline.

## Workflow invariants
- Payment success does not directly activate a licence.
- Subscription, payment, licence, and entitlement are separate concepts.
- Licence lifecycle transitions belong to Licence Engine.
- Entitlement resolution belongs to Entitlement Engine.
- Cross-module workflows use the durable operation journal.
- Admin changes use owning module interfaces and are audited.
- Notification failure does not roll back the originating operation.
- Recovery is idempotent and preserves history.
