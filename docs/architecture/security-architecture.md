# Security Architecture

## Principles
HTTPS externally; server-side authorization; fail closed; least privilege; auditable privileged actions; secrets outside source control; encrypted backups with tested restoration.

## Identity and sessions
- Permanent immutable account ID and globally unique immutable username.
- Email comparison: trim surrounding whitespace and lowercase; do not remove dots or plus-tags.
- Mobile comparison: normalize to E.164 including country code.
- Preserve original verified contact values separately.
- Email/mobile globally unique and mutable only after verification.
- Passwords securely hashed; never store or log plaintext.
- Proposed access-token lifetime: 5–10 minutes.
- Refresh tokens are session-bound, rotated, and protected by reuse detection.
- Session expiry follows the configured midnight IST calendar boundary; refresh cannot exceed absolute expiry.
- Logout revokes the server session; do not report successful server logout when the request fails.

Token format, signing algorithms, key rotation, and exact session implementation are Level 5 decisions.

## Privileged access
Admin MFA is mandatory. TOTP is preferred. SMS is weaker and must not be treated as equivalent assurance for privileged actions. Ownership recovery requires evidence and appeal safeguards.

## Authorization
Validate the applicable session, account, business, membership, role/policy, device, licence, entitlement, and resource scope/action. Easy License supplies generic access signals; consuming products retain domain-specific authorization.

## API protection
TLS, authentication/authorization middleware, bounded validated inputs, rate limits, request/correlation IDs, idempotency for retryable operations, parameterized database access, and non-disclosing error responses.

## Device and offline security
Device identity should be cryptographically bound to a public/private key pair, not trusted from a client-supplied identifier alone. Offline signed leases are a planned enhancement: proposal is 72-hour lease, 7-day grace, configurable ceiling 30 days. Clock rollback, exact semantics, and revocation delay remain unresolved. Offline leases cannot authorize server-side operations.

## Audit and operations
Audit authentication failures, administrative changes, licence/device transitions, and recovery actions. Never log passwords, raw tokens, or private keys. Use secret management, key rotation, encrypted backups, restricted production access, security monitoring, dependency scanning, and SSRF controls for outbound webhooks (private/loopback/link-local blocking, DNS validation, redirect controls, egress restrictions).
