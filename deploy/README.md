# Deployment contracts

The checked-in schema-v2 contract describes the current 0.3.x whole-core
deployment. Its release manifests pin the control-plane, web, and worker images
by digest. Installation-owned Fly configuration consumes those exact
references. Tags are descriptive and are never deployment identity.

The approved target separates Vorton core releases from installation-module
releases. A module release binds its manifest, browser artifact, server
artifact, jobs, migrations, capabilities, storage and secret declarations,
skills, tools, compatibility, backup, recovery, deletion, and rollback rules to
one immutable digest. Installing a module release does not activate it in any
workspace. Activating or rolling back an exact version changes the
workspace-module projection without rebuilding the Vorton shell.

A deployment operation is separate from `init apply` and `upgrade apply`. A
core deployment verifies the installation lock, an all-workspace backup,
staging rehearsal, migration serialization, workspace identity preservation,
and isolated recovery before changing cloud state. It records the observed
release, source commit, image digests, migration head, and verification receipts
in Postgres after health checks.

A module deployment verifies the exact installed and target module releases,
creates and proves a module-scoped backup, applies expand-first schema changes,
registers server and job artifacts with the shared runtime, and activates the
version only in approved workspaces. It does not allocate one always-on service
per module by default.

Core application rollback redeploys the prior observed image digest. Module
rollback restores the prior workspace activation while retaining compatible
artifacts and data. Neither operation pretends to reverse migrations or mutable
records. Database recovery is a forward repair or an explicitly authorized
restore. Whole-installation restoration is catastrophic recovery because it
rewinds every workspace. Ordinary recovery restores a workspace or module into
an isolated namespace first.

The schemas in this directory define the portable OCI identity and Fly deployment request. They contain secret names only. Secret values and runtime receipts never belong in Git. Each deterministic release contract archive also carries the exact authoritative Supabase migration SQL from its tagged source so an installer does not need to infer database state from a moving branch.
