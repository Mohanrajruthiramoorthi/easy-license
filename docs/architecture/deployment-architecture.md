# Deployment Architecture

## Current position
The initial logical architecture is a modular monolith. No production hosting provider, compute topology, or managed database provider has been selected.

## Logical runtime inventory
- Spring Boot API application.
- PostgreSQL database.
- Scheduled expiry, renewal, grace-period, and reconciliation jobs.
- Configured payment/notification integrations.
- Centralized application/security logs and operational metrics.

## Environments
Plan separate development, test/QA, and production environments with isolated credentials and data. Production data must not be copied into lower environments without approved anonymization.

## Data and recovery
PostgreSQL is the selected database technology. Module ownership remains explicit even if modules share a database instance. Backups must be encrypted and restoration tested. Migrations must be controlled and observable. Recovery jobs must be idempotent and restartable. RPO, RTO, HA, and retention targets remain open.

## Network and secrets
HTTPS externally; database not publicly exposed; secrets/signing keys outside source control; restricted and audited production access; controlled outbound egress and webhook SSRF protections.

## Unselected
Hosting provider, container/VM platform, WAF/reverse proxy, managed PostgreSQL, CI/CD, monitoring stack, backup schedule, and recovery objectives. Do not deploy production infrastructure before these choices are reviewed.
