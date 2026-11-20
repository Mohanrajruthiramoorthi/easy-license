# Architecture Overview

## Purpose
Easy License is an independent, application-agnostic licence-holding and licence-management service. It stores account/business, product, subscription, licence, device, and generic entitlement data and provides basic lifecycle and validation capabilities. Consuming applications own their feature definitions, business rules, configuration, permissions, and enforcement behavior.

## Baseline
- Architecture: modular monolith, not a collection of microservices.
- Backend: TypeScript on Firebase Cloud Functions (2nd gen), with Express HTTP routing.
- Database: PostgreSQL 17 on Neon.
- External interface: versioned HTTPS REST/JSON API.
- Cross-module coordination: synchronous orchestration + durable operation journal.
- Payment scope: record externally supplied payment details only; no payment processing or gateway integration.
- Background work: narrowly scoped scheduled functions only when required for licence and record lifecycle management.
- Product boundary: consuming applications define entitlement codes, types, meanings, and enforcement; Easy License stores generic application-scoped entitlement data.

## Logical request path
```text
Consuming Product -> Firebase HTTPS Function -> Authentication/Validation
                  -> Application Orchestration
                  -> Module Service Interfaces
                  -> Module-owned persistence -> Neon PostgreSQL
```

## Modules
1. Identity & Authentication
2. Business & Membership
3. Product Registry
4. Subscription/Licence Records
5. Payment Information Records (recordkeeping only; no payment processing)
6. Licence Management
7. Entitlement Registry (generic storage and retrieval; no application-specific feature logic)
8. Device Registry
9. Audit History
10. Licence Validation API
11. Basic Administration
12. Basic Lifecycle Jobs (as needed)

## Domain distinctions
- Subscription is the commercial agreement.
- Payment records store externally supplied payment information for reference; Easy License does not process or verify payments.
- Licence is an authorization grant with a lifecycle.
- Entitlement is an application-defined feature, capability, quota, limit, tier, or scope; Easy License stores its generic identifier and value but does not define its behavior.
- Membership is the relationship between an account and a business.

## Cross-module consistency
Each module commits its own transaction. An orchestrator tracks workflow and step progress in a durable operation journal. Calls use stable operation/idempotency identities. Retries resume after process restart. Cross-module workflows are not one automatically atomic database transaction.

## API principles
HTTP handlers handle routing, authentication middleware, validation, rate limits, versioning, request IDs, and error mapping. Business logic remains in modules. Clients never access internal modules or databases directly.

## Failure principles
Authorization fails closed. Notification failure does not roll back the originating business operation. Recovery jobs are idempotent, bounded, restartable, and observable. Ambiguous high-risk cases require manual review.

## Hosting and scaling constraints
- Deploy Functions in `asia-southeast1`.
- Set `minInstances: 0` and a conservative `maxInstances` to avoid idle compute and bound connection fan-out.
- Keep a small PostgreSQL pool per warm function instance.
- Store database credentials in Firebase Secret Manager, never in source or ordinary environment files.
- Firebase Functions requires Blaze billing. Free quotas are not a hard spending cap.

## Open design items
API token protocol, physical schema strategy, performance/availability objectives, exact retention policies, and the minimum required module set remain to be decided.
