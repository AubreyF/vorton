# Fly runtime contract

This directory defines four Fly apps: the public control plane, the public authenticated API, the private executive worker, and private Hindsight derived memory. Replace every placeholder before deployment. Release automation must deploy OCI digests, not mutable tags.

## Authority boundary

`AUBOS_DATABASE_URL` is the authoritative AubOS Supabase/Postgres connection. Only the API uses it. The login is the `NOINHERIT`, `NOBYPASSRLS` runtime identity created by the first-install bootstrap, not a migration identity or Supabase service role. `AUBOS_DATABASE_CONTEXT_SIGNING_SECRET` binds each person or worker context to one PostgreSQL transaction. Keep it separate from the database password. If the database certificate chains to a private authority, base64-encode the PEM certificate and provide it as `AUBOS_DATABASE_SSL_CA_BASE64`; certificate verification remains enabled. The stateless recommendation worker has no database connection. Hindsight must use `HINDSIGHT_API_DATABASE_URL` for a separate per-installation Supabase project or a separately owned Postgres database with pgvector. The two URLs must not be equal. There is no fallback from Hindsight to `AUBOS_DATABASE_URL`.

Hindsight is derived and untrusted. A recall result is evidence input at most. It cannot create Policy, grants, approvals, Work, receipts, or outcomes. Its Fly service has no public port. API key tenant authentication remains mandatory on the private network, and MCP is disabled.

Factory is read-only in this runtime. No runtime route or worker adapter may contact or mutate the Freed pilot.

## Required secrets

Set these through Fly secrets. Never place values in TOML or browser build arguments:

- API: `AUBOS_DATABASE_URL`, `AUBOS_DATABASE_CONTEXT_SIGNING_SECRET`, `AUBOS_WORKER_SHARED_SECRET`, `AUBOS_HINDSIGHT_API_KEY`.
- Worker: `AUBOS_WORKER_SHARED_SECRET`, `AUBOS_OPENAI_API_KEY`.
- Hindsight: `HINDSIGHT_API_DATABASE_URL`, `HINDSIGHT_API_TENANT_API_KEY`, `HINDSIGHT_API_LLM_API_KEY`, `HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY`.

The worker secret must match between API and worker. `AUBOS_WORKER_MODEL` on the API must exactly match `AUBOS_OPENAI_MODEL` on the worker. The API resolves the installation, Work, worker, assigned role, evidence, and active `executive.propose` recommendation grant from authoritative Postgres before dispatch. It validates the provider response boundaries and records the worker run after return. The worker cannot select an identity and has no database credential. Provider response storage defaults to false and background requests fail while storage is false.

The canonical API and worker build definitions are `deploy/docker/control-plane.Dockerfile` and `deploy/docker/worker.Dockerfile`. Every Node and nginx base is pinned by tag and multi-architecture digest. The Hindsight Fly template uses the separately pinned v0.9.1 slim image.

Before deployment, validate that `AUBOS_DATABASE_URL !== HINDSIGHT_API_DATABASE_URL`, the Hindsight database has PostgreSQL 14 or newer plus pgvector, the Supabase JWT issuer/JWKS/project ref match, and every provider/model field is explicit. The slim Hindsight image uses an external OpenAI-compatible embeddings provider and the dependency-free `rrf` reranker. The browser receives only the Supabase URL, public anon key, and public API URL. It must never receive `AUBOS_DATABASE_URL`, service-role keys, worker secrets, Hindsight keys, or provider keys.
