# Zero-cost MVP deployment

This deployment targets a **$0/month MVP / internal-testing environment**. It deliberately avoids paid Render resources and avoids Google Cloud billing.

## Architecture

| Component | Provider | Plan | Purpose |
| --- | --- | --- | --- |
| Spring Boot API | Render | Free Docker web service | Runs the existing Java 25 container |
| PostgreSQL 17 | Neon | Free | Persistent relational database |
| Angular frontend | Not deployed yet | Firebase Hosting Spark can be used later | The admin/business portals are still planned |

There is one API environment on `main`; this is not a separate staging/production setup.

## Free-tier limits and trade-offs

### Render API

- Free web services include 750 instance-hours per workspace per month, enough for one service to run for a month.
- A service spins down after 15 minutes without inbound traffic and typically takes about a minute to wake up.
- Free services may restart at any time and have an ephemeral filesystem. Do not store uploaded files or database data on the container filesystem.
- Free services are intended for hobby projects and testing, not production applications.
- If the workspace exceeds free bandwidth or build-pipeline allowances and no payment method is configured, Render suspends the affected services/builds instead of charging an overage.

### Neon PostgreSQL

- Free plan: 1 GB storage per project, 100 compute-hours per month, and 5 GB public network transfer per project.
- Compute scales to zero after five minutes of inactivity. The first request after idle may experience database wake-up latency.
- If compute-hours or network transfer are exhausted, the project compute is suspended until the quota resets or the plan is upgraded. Neon does not bill free-plan overages.
- Use the pooled connection endpoint to keep application connection usage low.

### Firebase Hosting (when the Angular portal exists)

Firebase Hosting Spark can host static Angular builds without enabling billing. Current no-cost Hosting allowance is 10 GB stored content and 360 MB/day data transfer. If a Spark quota is reached, the relevant service is paused until the quota resets; it does not automatically become pay-as-you-go. Do not link this Firebase project to a billing account if strict no-billing behavior is required.

Cloud Run is intentionally not used in this zero-cost configuration: it requires a Cloud Billing account, and usage beyond its free allowance can be charged.

## Create the Neon database

1. Create a Neon account and a new project.
2. Select PostgreSQL 17 and the Singapore region if it is offered for your account.
3. Create a database named `easy_license` (or note the generated database name).
4. Copy the **pooled** connection hostname and database credentials from Neon.
5. Do not commit connection strings, usernames, or passwords to Git.

Neon connection details:
- JDBC URL: `jdbc:postgresql://<pooled-hostname>/<database-name>?sslmode=require`
- `DATABASE_USERNAME`: the Neon role/user.
- `DATABASE_PASSWORD`: the Neon role password.

Replace the placeholders with the actual values. Keep the hostname only in the URL; do not include credentials in the URL when using the separate username/password variables.

## Create the Render service

1. Connect Render to the GitHub repository.
2. Create a Blueprint from the `main` branch and select the root `render.yaml`.
3. Confirm the plan contains exactly one **Free** web service and no Render Postgres databases or paid resources.
4. During setup, provide `DATABASE_URL`, `DATABASE_USERNAME`, and `DATABASE_PASSWORD` using the values from Neon.
5. Deploy and wait for the health check to pass.
6. Verify `https://<render-service>.onrender.com/actuator/health`.

The API uses Flyway at startup and Hibernate schema validation. The Neon database is external to Render, so its credentials are configured as unsynchronized environment variables in the Blueprint and must be entered in the Render dashboard.

## Cost guardrails

- Do not add a payment method to the Render workspace while the strict $0 requirement applies. If free usage is exhausted, allow the service/build to suspend rather than enabling paid overages.
- Do not upgrade Neon from Free or enable paid add-ons.
- Do not attach a Google Cloud billing account or switch Firebase to Blaze for this configuration.
- Check Render and Neon usage dashboards regularly.
- No provider can guarantee uninterrupted availability under free-tier limits.

## Production warning

This configuration is for an MVP, integration testing, demos, and low-volume experimentation only. **Do not store real customer data or depend on it for a production licensing/authorization decision.** Free services can sleep, restart, suspend at quota, and have limited operational guarantees. Before onboarding paying customers, move to paid compute/database plans with backups, monitoring, restore testing, and an availability plan.
