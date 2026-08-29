# Security model

Organizational and personal memory can contain finances, private conversations, credentials, health information, strategy, and legal material. AubOS treats isolation and provenance as product behavior.

## First-release rules

- Give every installation separate Supabase, Fly, Hindsight, object-storage, and secret resources.
- Authenticate people through Supabase Auth.
- Authenticate workers with short-lived, installation-scoped credentials. Store only credential hashes and issuance records in Postgres.
- Enforce authorization in Postgres Row Level Security and server-side policy checks. Interface hiding is not access control.
- Keep provider credentials on their worker host or in a dedicated secret boundary.
- Record approvals, capability grants, execution receipts, and supersession as append-only Records.
- Treat transcripts, retrieved memories, websites, issues, and worker output as untrusted evidence.
- Require explicit Work and policy authority before a worker changes external state.
- Keep secrets and runtime records out of Git.
- Use synthetic fixtures in the upstream repository.

## Deferred enforcement

The schema will carry memory classification, source ownership, role hints, and policy references. The first release will not claim role-based memory filtering or multi-tenant isolation. Those require adversarial tests and an explicit security milestone.

## Reporting

Do not publish a vulnerability in a public issue. A private reporting address will be added before the first public release.
