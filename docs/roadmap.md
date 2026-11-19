# Roadmap

## Phase 0 — Repository and architecture foundation
- [x] Initialize private repository.
- [x] Record architecture baseline and module ownership.
- [x] Record approved ADL-001 and ADL-007.
- [ ] Add complete approved Level 4 workflow specification and amendments.
- [ ] Resolve remaining high-impact ADLs.
- [ ] Review/freeze architecture baseline.

## Phase 1 — Level 5 technical design
- [ ] Package boundaries and dependency rules.
- [ ] API contracts and error model.
- [ ] Database ownership/schema and migration strategy.
- [ ] Operation journal, retry and concurrency design.
- [ ] Authentication, token, key and device protocols.
- [ ] Observability, audit, backup and recovery.
- [ ] Test strategy and quality gates.

## Phase 2 — Foundation implementation
- [ ] Java 21 / Spring Boot application.
- [ ] PostgreSQL integration and migrations.
- [ ] Module skeletons and dependency enforcement.
- [ ] API versioning, request IDs, validation and error handling.
- [ ] CI build, tests, static analysis and dependency scanning.

## Phase 3 — Business capabilities
Implement in dependency-aware increments while preserving approved workflows and ownership boundaries.

## Phase 4 — Deployment readiness
- [ ] Select hosting and managed database.
- [ ] Define environments and secrets.
- [ ] Implement deployment pipeline.
- [ ] Verify backup/restore.
- [ ] Complete security and operational readiness review.

No production deployment until security, recovery, monitoring, operations, and hosting decisions are documented and tested.
