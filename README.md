# Easy License

Easy License is a standalone, application-agnostic licensing platform. It manages identity, businesses, subscriptions, payments, licences, entitlements, devices and authorization through a versioned integration API.

## Architecture

- Modular monolith implemented as a TypeScript HTTP API on Firebase Cloud Functions (2nd gen).
- PostgreSQL 17 on Neon as the system of record.
- Firebase Hosting is reserved for the planned Angular 21 administration portal.
- Synchronous module-to-module calls through explicit service contracts.
- OpenAPI contract for external integrations.
- Scheduled lifecycle processing will use narrowly scoped scheduled functions when required.
- No event broker in the initial architecture.

## Repository layout

- `functions/` — TypeScript Firebase Functions API.
- `functions/sql/` — reviewed PostgreSQL migrations.
- `admin-portal/` — platform administration UI (planned).
- `business-portal/` — business portal (planned).
- `sdk/` — integration SDKs (planned).
- `docs/` — architecture decisions and workflow documentation.

## Deployment

See [Firebase deployment guide](docs/deployment/firebase.md). The API is deployed to Firebase Cloud Functions in `asia-southeast1` and connects to Neon PostgreSQL using a Secret Manager secret.

**Billing note:** Firebase Functions requires the Blaze plan and a linked Cloud Billing account. Free usage allowances apply, but overages can be billed. A budget alert is not a hard spending cap. This deployment is not a guaranteed $0 service.

## Local development

Requirements:
- Node.js 22+
- npm
- Firebase CLI
- A Neon PostgreSQL database or local PostgreSQL 17

Install and run checks:

```bash
cd functions
npm install
npm test
npm run build
```

Run the Firebase Functions emulator from the repository root:

```bash
firebase emulators:start --only functions
```

Set `DATABASE_URL` locally using the Firebase Functions emulator's supported local secret configuration. Never commit database credentials.

The initial API foundation exposes liveness and database-readiness endpoints. Domain workflows will be added module by module with migrations and tests.
