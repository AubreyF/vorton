# Fly runtime contract

This directory defines four Fly apps: the public control plane, the public authenticated API, the private executive worker, and private Hindsight derived memory. Replace every placeholder before deployment. Release automation must deploy OCI digests, not mutable tags.

## Authority boundary

`VORTON_DATABASE_URL` is the authoritative Vorton Supabase/Postgres connection. Only the API uses it. The login is the `NOINHERIT`, `NOBYPASSRLS` runtime identity created by the first-install bootstrap, not a migration identity or Supabase service role. `VORTON_DATABASE_CONTEXT_SIGNING_SECRET` binds each person or worker context to one PostgreSQL transaction. Keep it separate from the database password. If the database certificate chains to a private authority, base64-encode the PEM certificate and provide it as `VORTON_DATABASE_SSL_CA_BASE64`; certificate verification remains enabled. The stateless recommendation worker has no database connection. Hindsight must use `HINDSIGHT_API_DATABASE_URL` for a separate per-installation Supabase project or a separately owned Postgres database with pgvector. The two URLs must not be equal. There is no fallback from Hindsight to `VORTON_DATABASE_URL`.

Hindsight is derived and untrusted. A recall result is evidence input at most. It cannot create Policy, grants, approvals, Work, receipts, or outcomes. Its Fly service has no public port. API key tenant authentication remains mandatory on the private network, and MCP is disabled.

Factory is read-only in this runtime. No runtime route or worker adapter may contact or mutate the Freed pilot.

## Required secrets

Set these through Fly secrets. Never place values in TOML or browser build arguments:

- API: `VORTON_DATABASE_URL`, `VORTON_DATABASE_CONTEXT_SIGNING_SECRET`, `VORTON_WORKER_SHARED_SECRET`, `VORTON_HINDSIGHT_API_KEY`.
- Worker: `VORTON_WORKER_SHARED_SECRET`, plus one-time `VORTON_CODEX_AUTH_JSON` bootstrap material when the persistent cache is empty.
- Hindsight: `HINDSIGHT_API_DATABASE_URL`, `HINDSIGHT_API_TENANT_API_KEY`. Codex authentication belongs in the dedicated persistent volume described below, never in a Fly secret.

The worker secret must match between API and worker. `VORTON_WORKER_MODEL` on the API must exactly match `VORTON_CODEX_MODEL` on the worker. The API resolves the installation, Work, worker, assigned role, evidence, and active `executive.propose` recommendation grant from authoritative Postgres before dispatch. It validates the provider response boundaries and records the worker run after return. The worker cannot select an identity and has no database credential. It runs one serialized Codex stream against a dedicated persistent `auth.json`, disables every Codex tool surface, and rejects background work. Do not share that cache with another service or machine.

Before deploying the subscription profile, inspect Fly secret names for the API, worker, and Hindsight applications with `fly secrets list --json --app <app>`. Review names only. Never print or export values. Refuse deployment if the API or worker has `OPENAI_API_KEY` or `VORTON_OPENAI_API_KEY`. Refuse deployment if Hindsight has any provider credential such as `OPENAI_API_KEY`, `HINDSIGHT_API_LLM_API_KEY`, `HINDSIGHT_API_CONSOLIDATION_LLM_API_KEY`, or `HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY`. Hindsight may retain only its database URL and tenant API key from the persistent-secret list above. Removing an obsolete platform secret is a separate owner-authorized mutation, followed by a fresh name-only audit.

Each synchronous subscription request has a 900000 millisecond worker deadline, including any wait for the single auth queue. Codex receives nearly the entire window during normal single-stream use. The API request boundary is 930000 milliseconds so the worker can terminate a timed-out process before the caller gives up. Deployment validation requires the API margin to remain from 10000 through 60000 milliseconds. A timed-out worker first terminates the Codex process group, then uses a hard kill after a short grace period. The auth queue is released after bounded cleanup, even if a child fails to report its exit.

Bootstrap the executive worker credential exactly once:

1. Stage `VORTON_CODEX_AUTH_JSON` through standard input only while the auth volume is empty.
2. Deploy the worker and require `/healthz` to pass.
3. Restart the worker and verify that `/data/codex/auth.json` remains valid on the mounted volume.
4. With explicit credential-removal authority, run `fly secrets unset VORTON_CODEX_AUTH_JSON --app <worker-app>`.
5. Require the Machine created by that secret update to pass `/healthz` without the seed. The rotating volume cache is now the only worker credential store.

Do not leave the seed in Fly after this proof. Deleting it from `process.env` inside the running process does not delete the platform secret.

The canonical API and worker build definitions are `deploy/docker/control-plane.Dockerfile` and `deploy/docker/worker.Dockerfile`. Every Node and nginx base is pinned by tag and multi-architecture digest. The Hindsight Fly template uses the separately pinned v0.9.1 full image because it runs the pinned embedding model locally and includes the native `openai-codex` provider.

Worker and Hindsight are private 6PN services. They bind IPv6, define top-level health checks, and declare no Fly Proxy service. The public API pins a 960-second proxy idle timeout, which exceeds its 930-second worker request deadline by 30 seconds.

Before deployment, validate that `VORTON_DATABASE_URL !== HINDSIGHT_API_DATABASE_URL`, the Hindsight database has PostgreSQL 14 or newer plus pgvector, and the Supabase JWT issuer/JWKS/project ref match. Hindsight uses the pinned local `BAAI/bge-small-en-v1.5` embedder on CPU and the dependency-free `rrf` reranker. Native Codex fact extraction, observations, and automatic consolidation use `gpt-5.4-mini` at low reasoning with strict schema validation and one concurrent invocation. The browser receives only the Supabase URL, public anon key, and public API URL. It must never receive `VORTON_DATABASE_URL`, service-role keys, worker secrets, Hindsight keys, or provider credentials.

## Hindsight Codex bootstrap

The pinned Hindsight image runs as UID 1000. Missing or malformed ChatGPT authentication can prevent provider construction, but Hindsight's startup connection probe is warning-only and cannot serve as an acceptance gate. Seed its private volume in two stages:

1. Create one dedicated Hindsight volume. One mounted Fly volume binds the deployment to one Machine for this MVP.
2. Deploy the final Hindsight configuration with temporary command-line environment overrides: `HINDSIGHT_API_LLM_PROVIDER=none`, `HINDSIGHT_API_CONSOLIDATION_LLM_PROVIDER=none`, and `HINDSIGHT_API_ENABLE_OBSERVATIONS=false`. Do not commit those values.
3. Enter the Machine as root. Create `/data/hindsight-codex`, set its owner to UID and GID 1000, and set mode `0700`.
4. In a fresh isolated local `CODEX_HOME`, run `codex login --device-auth` and `codex login status`. Before upload, parse `auth.json` locally and require `auth_mode=chatgpt` plus nonempty access token, account ID, and refresh token. The check must print only pass or fail, never credential values.
5. Upload that dedicated `auth.json` with `fly ssh sftp put`. Store it at `/data/hindsight-codex/auth.json`, set owner UID and GID 1000, and set mode `0600`. Never copy the executive worker's auth cache.
6. Deploy the checked-in final configuration without the temporary overrides. Readiness must pass at `/health/ready`; liveness must pass at `/health/live`.

`HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP=false` is the steady-state rule. An existing v0.9.1 database needs no migration for this profile change. For a brand-new empty database only, temporarily set it to `true` during the first bootstrap, allow the migration to complete, then restore the checked-in `false` value before the final deployment.

The release canary must call the bank LLM health probe and require healthy retain and consolidation operations. It must then retain synthetic evidence in a synthetic bank, poll the asynchronous consolidation status with a deadline, fail on any failed consolidation, wait for a derived observation, and confirm the observation cites the retained source before allowing real memory ingestion. A separate reflection smoke test may verify advisory narrative, but reflection cannot satisfy the cited-memory gate. Delete the synthetic bank after the canary. A healthy process, database check, or warning-only startup provider probe does not prove the subscription lane works.

Run the executable gate from a trusted host that can reach the private Hindsight service, such as through a temporary `fly proxy`. From an extracted release contract archive, set `VORTON_HINDSIGHT_URL` and `VORTON_HINDSIGHT_API_KEY`, then run `node bin/hindsight-canary.cjs`. A full source checkout may use `npm run runtime:hindsight-canary`. The archive command is bundled and runs without installing workspace dependencies. The canary uses only unique synthetic material, polls consolidation for at most five minutes by default, proves complete citation hydration and exhaustive source retirement, and deletes its synthetic bank even when a check fails. `VORTON_HINDSIGHT_CANARY_TIMEOUT_MS` and `VORTON_HINDSIGHT_CANARY_POLL_INTERVAL_MS` provide bounded operator overrides.
