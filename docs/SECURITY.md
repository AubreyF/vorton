# Security model

Organizational and personal memory can contain finances, private conversations, credentials, health information, strategy, and legal material. Vorton treats isolation and provenance as product behavior.

## Trust boundary

One installation is one infrastructure and administrator trust domain. It may
contain many logically isolated workspaces. Workspace members are isolated by
PostgreSQL membership, RLS, signed server context, scoped workers, and scoped
service namespaces. An infrastructure administrator remains technically able
to control the installation. A workspace requiring protection from that
administrator needs a separate installation.

Installation administration does not grant ordinary product-level content
access. Emergency access requires a time-bound break-glass path, recent AAL2,
a reason, and an immutable receipt.

## First-release rules

- Authenticate people through Supabase Auth.
- Require explicit live PostgreSQL workspace membership. Authentication alone
  grants no workspace access or authority.
- Carry `vortonInstallationId` and `workspaceId` through every workspace-owned
  request, row, object, cache, job, event, log, receipt, export, backup, and
  deletion operation.
- Authenticate workers with short-lived, installation- and workspace-scoped
  credentials. Store only credential hashes and issuance records in Postgres.
- Enforce authorization in Postgres Row Level Security and server-side policy checks. Interface hiding is not access control.
- Keep provider credentials on their worker host or in a dedicated secret boundary.
- Record approvals, capability grants, execution receipts, and supersession as append-only Records.
- Treat transcripts, retrieved memories, websites, issues, and worker output as untrusted evidence.
- Require explicit Work and policy authority before a worker changes external state.
- Keep secrets and runtime records out of Git.
- Use synthetic fixtures in the upstream repository and ephemeral staging.
  Never populate the production AubOS workspace with synthetic records.
- Serve lazy module UI artifacts only through authenticated,
  content-addressed, same-origin paths resolved from the installation catalog.
- Give supervised module processes narrow brokers rather than ambient database,
  secret, filesystem, or network authority.
- Treat deactivation, data deletion, backup expiry, and code removal as
  separate lifecycle operations.

## Shared services and recovery

Sharing Supabase, Fly, Hindsight, object storage, workers, or model
authentication does not share a workspace namespace. Cache keys, object keys,
memory banks, queues, budgets, and receipts remain scoped and fail closed.

Whole-installation point-in-time recovery rewinds every workspace and is
reserved for catastrophic failure. Workspace and module logical backups support
ordinary isolated recovery. Shared database migrations require an
all-workspace backup, staging rehearsal, expand-first schema changes, and
identity-preservation verification.

The MVP exposes no cross-workspace business-data search, Council, Factory
queue, or memory view. A neutral hostname and workspace label never infer
authority.

## Deferred enforcement

Role-based memory filtering remains future scaffolding and is not an MVP
security claim. Shared-workspace production activation still requires
adversarial proof across database, Auth, RLS, workers, storage, memory, events,
backups, recovery, modules, and runtime caches. Documentation or unit tests do
not satisfy that proof.

## Reporting

Do not publish a vulnerability in a public issue. A private reporting address will be added before the first public release.
