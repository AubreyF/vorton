# First-install bootstrap

This admin-run bootstrap creates the smallest organizational graph needed for one executive recommendation. It does not create a Supabase Auth user. Create and verify that account through Supabase Auth first, then pass its UUID as `AUBOS_BOOTSTRAP_AUTH_USER_ID`.

The operation creates one organizational installation, owner membership, recommendation worker, role and assignment, recommendation-only Policy and capability grant, ready Work item, and evidence record. Every identity is deterministic from the installation slug. Reapplying the same configuration is a no-op. Conflicting existing data aborts the transaction.

The API runtime login has `NOINHERIT`, `NOBYPASSRLS`, no direct table privileges, and membership only in `authenticated` and `aubos_worker`. Each person or worker transaction carries an HMAC envelope bound to the PostgreSQL transaction ID, installation, and subject. The signing secret is distinct from the database password and lives in the API secret store plus an inaccessible private database schema. A leaked database URL can connect and set either role, but cannot manufacture a context that RLS accepts.

The migration or bootstrap identity remains separate. It must be able to create roles, grant `authenticated` and `aubos_worker`, write the private context-key table, read `auth.users`, and apply migrations. Do not give those credentials to the API. Replaying bootstrap preserves an existing runtime password and context key. Credential rotation requires a separate explicit operation, which the MVP deliberately does not provide.

Plan without supplying database credentials:

```sh
AUBOS_BOOTSTRAP_AUTH_USER_ID=<supabase-auth-user-uuid> \
AUBOS_WORKER_PROVIDER=codex-subscription \
AUBOS_WORKER_MODEL=<explicit-codex-model> \
AUBOS_CODEX_MODEL=<same-explicit-codex-model> \
AUBOS_CODEX_REASONING_EFFORT=high \
npm run bootstrap:plan
```

Apply after migrations through `20260828000400_runtime_authority`:

```sh
AUBOS_BOOTSTRAP_AUTH_USER_ID=<supabase-auth-user-uuid> \
AUBOS_WORKER_PROVIDER=codex-subscription \
AUBOS_WORKER_MODEL=<explicit-codex-model> \
AUBOS_CODEX_MODEL=<same-explicit-codex-model> \
AUBOS_CODEX_REASONING_EFFORT=high \
AUBOS_BOOTSTRAP_DATABASE_URL=<migration-or-bootstrap-postgres-url> \
AUBOS_BOOTSTRAP_RUNTIME_DATABASE_PASSWORD=<random-32-plus-character-secret> \
AUBOS_BOOTSTRAP_CONTEXT_SIGNING_SECRET=<different-random-32-plus-character-secret> \
npm run bootstrap:apply
```

TLS certificate verification is enabled by default. Set `AUBOS_BOOTSTRAP_DATABASE_SSL=false` only for a trusted local or test PostgreSQL socket that does not offer TLS. Any value other than exact `true` or `false` is rejected.

Supply production organization names and initial Work copy with the optional `AUBOS_BOOTSTRAP_*` variables defined in `provision.ts`. Defaults are synthetic Moonbase Lab data. The command never prints database URLs, passwords, signing secrets, email addresses, or the Auth user UUID. Configure the API's `AUBOS_DATABASE_URL` with the generated runtime role and password, and configure `AUBOS_DATABASE_CONTEXT_SIGNING_SECRET` with the separate signing secret.
