# Vorton Factory Freed connector

This package contains the governed execution runtime for Vorton's Factory module. It admits qualified repository work, binds each run to external execution authority, routes work to enrolled hosts, preserves custody through checkpoints, validates completed candidates, and publishes at most a draft pull request.

The runtime does not create an organizational backlog or grant itself repository authority. GitHub Issues remain the visible software queue for the FreedOS installation. Freed task claims remain its execution authority. Vorton records organizational intent, policy, approvals, Work relationships, worker inventory, and reconciled receipts.

## Source

The first import is a sanitized source snapshot from `AubreyF/aubtown` commit `014b786c8bf6b51a3ed265b4e36773afff0f5d59`. AubTown was the prototype repository for what is now Vorton Factory. The import excludes Git history, ignored files, dependency directories, build output, host state, reports, credentials, OAuth caches, and secrets.

Product-facing names use Vorton Factory. The Freed adapter remains explicit under `src/adapters/freed`. Freed-specific deployment examples remain examples, not Vorton defaults. Existing installed service names and filesystem paths may require a bounded compatibility migration before they can adopt the new names.

## Safety ceiling

Factory fails closed when authority, host identity, quota, custody, repository state, or conflict evidence is missing or stale. Workers do not receive repository credentials. Publication stops at a draft pull request. Merge, release, deployment, provider traffic, issue closure, signing, migrations, and secret changes require separate authority outside this runtime.

Run the complete package proof with:

```sh
npm run check --workspace @vorton/factory-connector-freed
```
