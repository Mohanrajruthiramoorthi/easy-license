# Architecture Overview

## Purpose
Easy License is an independent, application-agnostic licensing platform. It manages identity, commercial subscription, payment, licence, entitlement, device, and generic access policy capabilities for consuming products.

## Baseline
- Architecture: modular monolith
- Backend: Java 21 + Spring Boot
- Database: PostgreSQL
- External interface: versioned HTTPS REST/JSON API
- Cross-module coordination: synchronous orchestration + durable operation journal
- Background work: scheduled, restartable jobs

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
3. Roles & Access Policy
4. Subscription Management
5. Payment Management
6. Licence Engine
7. Entitlement Engine
8. Device Management
9. Product Configuration Registry
10. Audit & Security
11. Integration API
12. Admin Operations
13. Notifications
14. Recovery & Reconciliation

## Domain distinctions
- Subscription is the commercial agreement.
- Payment records financial transaction facts.
- Licence is an authorization grant with a lifecycle.
- Entitlement is a feature, capability, quota, limit, tier, or scope.
- Membership is the relationship between an account and a business.

## Cross-module consistency
Each module commits its own transaction. An orchestrator tracks workflow and step progress in a durable operation journal. Calls use stable operation/idempotency identities. Retries resume after process restart. Cross-module workflows are not one automatically atomic database transaction.

## API principles
Controllers handle routing, authentication middleware, validation, rate limits, versioning, request IDs, and error mapping. Business logic remains in modules. Clients never access internal modules or databases directly.

## Failure principles
Authorization fails closed. Notification failure does not roll back the originating business operation. Recovery jobs are idempotent, bounded, restartable, and observable. Ambiguous high-risk cases require manual review.

## Open design items
Hosting topology, API token protocol, physical schema strategy, performance/availability objectives, and exact retention policies remain to be decided.
