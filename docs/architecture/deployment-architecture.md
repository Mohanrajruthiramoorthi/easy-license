# Deployment Architecture

## Selected MVP topology
- TypeScript Express API deployed as Firebase Cloud Functions (2nd gen).
- Firebase Functions region: `asia-southeast1` (Singapore).
- PostgreSQL 17 hosted by Neon; the function connects over TLS using the pooled connection endpoint.
- Firebase Hosting is reserved for the planned Angular administration portal and is not configured until that frontend exists.

## Environments
Plan separate development, test/QA, and production Firebase projects and isolated Neon databases. Do not point non-production functions at production data. Production data must not be copied into lower environments without approved anonymization.

## Runtime and connection limits
- Functions use zero minimum instances and a conservative maximum of three instances for the initial MVP.
- Each warm instance creates at most two PostgreSQL connections.
- Functions do not rely on local disk for persistent data.
- Database migrations are reviewed and applied as controlled deployment steps; do not run DDL automatically on every cold start.

## Secrets and network
HTTPS externally; database credentials stored as Firebase Secret Manager secrets; TLS required for database connections; secrets and signing keys stay outside source control. CORS origins must be explicitly configured before browser clients are enabled.

## Billing and operational guardrails
Firebase Cloud Functions requires the Blaze plan and a linked Cloud Billing account. Free usage allowances apply but do not guarantee a $0 bill. Configure a Cloud Billing budget alert before deployment, review usage, and understand that budget alerts notify but do not stop spending. Keep `maxInstances` bounded and avoid minimum instances. No cloud resources are created by repository changes alone.

## Recovery
Neon backups, retention, restore testing, RPO, RTO, monitoring, and production availability objectives must be explicitly selected before production use.

## Deployment approval
Repository configuration and CI do not create Firebase projects, link billing accounts, create Neon databases, set secrets, or deploy services. Those are separate manual actions requiring explicit review.
