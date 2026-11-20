# Firebase Functions + Neon deployment

This guide deploys the TypeScript API to Firebase Cloud Functions (2nd gen) in Singapore and uses Neon PostgreSQL 17 as the system of record.

## Cost and billing warning

**Cloud Functions deployment requires the Firebase Blaze plan and a linked Google Cloud Billing account.** The platform includes no-cost usage allowances, but usage beyond them can be billed. A Cloud Billing budget alert is a notification, not a hard spending cap. The configured maximum of three function instances limits scaling but does not guarantee zero charges.

Do not proceed unless you accept the possibility of charges. This repository change does not create a Firebase project, link billing, create a Neon database, set secrets, or deploy anything.

## Architecture

| Component | Provider | Responsibility |
| --- | --- | --- |
| HTTP API | Firebase Cloud Functions 2nd gen | TypeScript Express API |
| Database | Neon PostgreSQL 17 | Persistent relational data |
| Secret storage | Firebase Secret Manager | Neon connection string |
| Planned admin UI | Firebase Hosting | Static Angular build, not configured yet |

The function is configured for `asia-southeast1`, zero minimum instances, at most three instances, and a two-connection PostgreSQL pool per instance.

## Prerequisites

- Firebase project with billing enabled on Blaze.
- Google Cloud Billing budget alert configured.
- Firebase CLI installed and authenticated.
- Neon PostgreSQL 17 project created (Singapore region if available).
- Node.js 22+ and npm.

## Configure the project

1. Create or select a dedicated Firebase project.
2. Upgrade the project to Blaze and link the intended Cloud Billing account.
3. In Google Cloud Billing, create a budget alert with conservative thresholds. Remember this does not cap spending.
4. Create a Neon PostgreSQL 17 project and database.
5. Copy the Neon **pooled** connection string. Require TLS and do not place the credentials in Git.
6. Copy `.firebaserc.example` to `.firebaserc` and replace the placeholder project ID, or run `firebase use --add`.
7. Set the database connection string as a Firebase secret:

```bash
firebase functions:secrets:set DATABASE_URL
```

Paste the Neon pooled connection string when prompted. Do not pass it as a command-line argument or commit it to a file.

## Install, test, and deploy

From the repository root:

```bash
cd functions
npm install
npm test
npm run build
cd ..
firebase deploy --only functions:api
```

Firebase CLI will build the TypeScript source and deploy the `api` HTTPS function. No database migration is automatically executed by the function at startup.

## Database migration

The initial identity-account schema is retained at `functions/sql/001_create_identity_account_tables.sql`. Review it and apply it once to the intended Neon database using a trusted PostgreSQL client or Neon SQL Editor before implementing identity endpoints. Record the migration version in the team's deployment log. Future migrations must be reviewed, forward-only, and applied as a controlled release step.

## Endpoints

After deployment, Firebase prints the HTTPS function URL. Append:

- `/healthz` — liveness; does not contact PostgreSQL.
- `/readyz` — readiness; runs a lightweight `SELECT 1` against Neon.

The API currently provides only health/readiness foundation routes. Identity, account registration, authentication, licensing and business workflows are not implemented yet.

## CORS

Before a browser-based admin portal is deployed, configure `CORS_ALLOWED_ORIGINS` as a comma-separated list of exact trusted origins in the function environment. Do not use a wildcard with credentialed requests. CORS is not an authentication or authorization mechanism.

## Cost and security checklist

- Keep `minInstances: 0` and review `maxInstances` before increasing it.
- Review Firebase/Google Cloud usage and billing after deployment.
- Keep the Neon database URL in Secret Manager only.
- Use a Neon pooled connection endpoint and retain the low pool size.
- Do not expose database credentials to browser clients.
- Add authentication, authorization, rate limiting, audit logging, and abuse controls before exposing business APIs.
- Do not use this foundation for production licensing decisions or real customer data until the security and recovery controls are implemented and reviewed.
