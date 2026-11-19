# Architecture Overview

## Purpose
Easy License is an independent, application-agnostic licence-holding and licence-management service. It stores account/business, product, subscription, licence, device, and generic entitlement data and provides basic lifecycle and validation capabilities. Consuming applications own their feature definitions, business rules, configuration, permissions, and enforcement behavior.

## Baseline
- Architecture: modular monolith
- Backend: Java 21 + Spring Boot
- Database: PostgreSQL
- External interface: versioned HTTPS REST/JSON API
- Cross-module coordination: synchronous orchestration + durable operation journal
- Payment scope: record externally supplied payment details only; no payment processing or gateway integration
- Background work: only the scheduled, restartable jobs required for basic licence and record lifecycle management
- Product boundary: consuming applications define entitlement codes, types, meanings, and enforcement; Easy License stores generic application-scoped entitlement data

## Logical request path
```text
Consuming Product -> Integration API -> Authentication/Validation
                  -> Application Orchestration
                  -> Module Service Interfaces
                  -> Module-owned persistence -> PostgreSQL
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
Controllers handle routing, authentication middleware, validation, rate limits, versioning, request IDs, and error mapping. Business logic remains in modules. Clients never access internal modules or databases directly.

## Failure principles
Authorization fails closed. Notification failure does not roll back the originating business operation. Recovery jobs are idempotent, bounded, restartable, and observable. Ambiguous high-risk cases require manual review.

## Open design items
Hosting topology, API token protocol, physical schema strategy, performance/availability objectives, exact retention policies, and the minimum required module set remain to be decided.
