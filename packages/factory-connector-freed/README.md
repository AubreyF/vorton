# Vorton Factory FreedOS compatibility package

This package contains the current FreedOS activation and implementation lineage
for Vorton's first-party Factory installation module. The current AubOS Factory
becomes that module. Factory may be activated in any workspace; FreedOS is its
first priority.

The approved destination has no external Factory control plane or claim
service. Factory owns dispatch claims, custody epochs, checkpoints, handoffs,
recovery, publication coordination, and execution receipts under Vorton Work,
Policy, capabilities, approvals, and Records. GitHub remains external
repository infrastructure and may remain authoritative for repository facts.

The package currently binds some transitions to the Freed application's task
projection and host broker. Those are transitional compatibility mechanics and
historical proof surfaces, not the final authority boundary. They remain
documented so the migration preserves duplicate prevention, custody, recovery,
and replay rather than waving at them with a fresh abstraction.

## Source

The first import is a sanitized source snapshot from `AubreyF/aubtown` commit `014b786c8bf6b51a3ed265b4e36773afff0f5d59`. AubTown was the prototype repository for what is now Vorton Factory. The import excludes Git history, ignored files, dependency directories, build output, host state, reports, credentials, OAuth caches, and secrets.

Product-facing names use Factory inside the selected workspace. The Freed
adapter remains explicit under `src/adapters/freed`. FreedOS deployment examples
are the first module activation, not Vorton defaults. Existing package names,
service names, filesystem paths, signed domains, and receipt formats require a
bounded compatibility migration before they can adopt final module identities.

## Safety ceiling

Factory fails closed when installation, workspace, authority, host identity,
quota, custody, repository state, or conflict evidence is missing or stale.
Every runtime envelope and durable object must carry `vortonInstallationId` and
`workspaceId`. Workers do not receive repository credentials. Publication
stops at a draft pull request. Merge, release, deployment, issue closure,
signing, migrations, and secret changes require separate Vorton authority.

Run the complete package proof with:

```sh
npm run check --workspace @vorton/factory-connector-freed
```
