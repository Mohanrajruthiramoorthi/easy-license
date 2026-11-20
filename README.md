# Easy License

Easy License is a standalone, application-agnostic licensing platform. It manages identity, businesses, subscriptions, payments, licences, entitlements, devices and authorization through a versioned integration API.

## Architecture

- Modular monolith; no microservices.
- Java 25 and Spring Boot backend.
- PostgreSQL as the system of record.
- Synchronous module-to-module calls through explicit service contracts.
- Angular 21 administration portal (planned).
- OpenAPI contract for external integrations.
- Scheduled jobs for time-based lifecycle processing.
- No event broker in the initial architecture.

## Repository layout

- `backend/` — Spring Boot backend.
- `admin-portal/` — platform administration UI (planned).
- `business-portal/` — business portal (planned).
- `sdk/` — integration SDKs (planned).
- `docs/` — architecture decisions and workflow documentation.

## Deployment

See [Render deployment guide](docs/deployment/render.md). The root `render.yaml` defines isolated Singapore staging and production services and databases.

## Local development

Requirements:
- JDK 25
- Maven 3.9+
- Docker Engine with Docker Compose

Start PostgreSQL:

```bash
docker compose up -d postgres
docker compose ps
```

Run the backend:

```bash
cd backend
mvn spring-boot:run
```

Health endpoint: `http://localhost:8080/actuator/health`

OpenAPI UI: `http://localhost:8080/swagger-ui.html`

The first foundation milestone intentionally does not introduce domain tables or business workflows. Those will be added module by module with migrations and tests.
