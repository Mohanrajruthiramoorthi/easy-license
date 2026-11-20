# Easy License — Initial Architecture

## Architectural style

Easy License starts as a modular monolith. The backend baseline is Java 25 with Spring Boot 4.1.3. Each business capability owns its data and exposes operations through explicit service interfaces. Modules communicate through direct synchronous calls.

## Initial module boundaries

1. Identity and Authentication
2. Business and Membership
3. Roles and Access Policy
4. Subscription Management
5. Payment Management
6. Licence Engine
7. Entitlement Engine
8. Device Management
9. Product Configuration Registry
10. Audit and Security
11. Integration API

## Rules

- External clients communicate only through the versioned Integration API.
- Clients never access the database directly.
- A module must not write data owned by another module.
- Cross-module operations use the owning module's service contract.
- PostgreSQL is the system of record.
- Time-based transitions are handled by scheduled jobs, with runtime validation for security-sensitive expiry.
- Fail closed when authentication, authorization, licence or device validation cannot be completed.
- No microservices, event broker or distributed transaction infrastructure in the initial implementation.

## Implementation sequence

1. Repository and backend foundation.
2. Database connectivity and migration baseline.
3. Shared API conventions and error handling.
4. Identity and authentication.
5. Business and membership.
6. Product configuration.
7. Subscription and payment.
8. Licence and entitlement.
9. Device management and authorization.
10. Administration and operational workflows.
