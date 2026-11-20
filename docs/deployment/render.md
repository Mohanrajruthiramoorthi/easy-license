# Render deployment

Easy License uses a Render Blueprint to define two isolated environments in Singapore.

| Environment | API service | Database | Branch |
| --- | --- | --- | --- |
| Staging | `easy-license-api-staging` | `easy-license-staging-db` | `feature/backend-foundation` |
| Production | `easy-license-api-production` | `easy-license-production-db` | `main` |

## Architecture

- Each environment has its own Render web service and PostgreSQL instance.
- Both databases are private to the Render network (`ipAllowList: []`).
- The API uses the database's private host/port and credentials injected by the Blueprint.
- Flyway applies versioned migrations at application startup; Hibernate validates the resulting schema.
- Render checks `/actuator/health` before routing traffic.
- Staging uses free compute/database resources for evaluation. Free services can sleep and free databases are temporary; do not store important or production data there.
- Production uses paid compute and a paid PostgreSQL plan. Review current Render pricing before creating the Blueprint.

## First-time setup

1. Ensure the Render account is connected to the GitHub account that can access the private `Mohanrajruthiramoorthi/easy-license` repository.
2. Merge the deployment configuration to `main` before provisioning production. The production service is deliberately pinned to `main`.
3. In Render Dashboard, choose **New → Blueprint**, select the repository and the `main` branch, and use the root `render.yaml`.
4. Review the Blueprint plan and resource summary. Confirm creation only after checking the paid production service and database plans.
5. Wait for both databases to become available and both services to finish their first deploy.
6. Verify:
   - `https://<staging-service>.onrender.com/actuator/health`
   - `https://<production-service>.onrender.com/actuator/health`
7. Keep production data separate. Never point staging at the production database.

## Deploy flow

- Pushes to `feature/backend-foundation` update staging after the Blueprint is created.
- Pushes to `main` update production after the Blueprint is created.
- GitHub Actions runs Maven verification and builds the Docker image on pushes and pull requests.
- Production should only receive reviewed, tested commits merged to `main`.

## Environment variables

Render injects `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` from the matching private database. No database password or connection string belongs in Git.

The application also accepts `DATABASE_URL`, `DATABASE_USERNAME`, and `DATABASE_PASSWORD` for local/CI compatibility. Those take precedence over the Render host-based settings.

## Operational notes

- Free staging resources are for smoke tests only and may sleep or expire according to Render's free-tier limits.
- Production database backups, retention, point-in-time recovery, and service availability depend on the selected Render plan. Confirm these in the Render dashboard.
- Configure a custom domain only after the first successful deploy and DNS ownership verification.
- Do not enable public database ingress. Use Render's internal network.
