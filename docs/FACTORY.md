# Factory module

Factory is Vorton's first-party software-factory module. The current AubOS
Factory implementation becomes this module. Factory may be activated in any
workspace, with FreedOS as the first priority.

Factory is not a connector to a permanent external Factory control plane. Its
dispatch, custody, checkpoint, handoff, recovery, publication, and execution
machinery belongs inside the module under Vorton authority.

## Authority

Vorton owns organizational intent, Policy, decisions, approvals, Work,
capabilities, worker admission, Records, receipts, and outcomes. Factory owns
software-execution state through those kernel contracts, including:

- dispatch candidates and qualification;
- claim identity and custody epoch;
- worker and host custody;
- conflict domains and branch ownership;
- checkpoints and handoffs;
- stale-claim reconciliation;
- execution, verification, and recovery;
- draft and final publication coordination; and
- complete execution and outcome receipts.

GitHub remains external repository infrastructure. It may remain authoritative
for issue content and state, commits, branches, pull requests, reviews, and
checks. The connector preserves those facts and changes them only through
declared Factory capabilities. A GitHub App installation identifier is
separately named and never grants Vorton authority.

Every Factory envelope, row, object, job, event, cache key, host path, and
receipt carries `vortonInstallationId` and `workspaceId`. Worker custody is
bound to the same tuple, exact Work, capability, claim, and epoch. Missing,
foreign, stale, duplicate, or conflicting custody fails closed.

## FreedOS delivery

The first usable milestone is real read-only Factory visibility inside the
FreedOS workspace. It displays:

- software tickets and their authoritative source;
- Vorton Work reconciliation;
- workers, hosts, claims, leases, and custody;
- branches, pull requests, reviews, and checks;
- blockers, freshness, and contradictions; and
- checkpoint, recovery, and completion state.

Read-only visibility makes no external change. It is followed immediately by
governed execution. Initial write operations require explicit Work,
capability, applicable Policy, idempotent admission, conflict denial, and
immutable receipts.

Factory supplies both workspace and installation emergency stops. A stop
blocks new admissions and lease renewal without deleting worktrees, evidence,
or recovery state. Credential revocation and destructive cleanup remain
separate governed actions.

## Implementation lineage

`packages/factory-connector-freed` is the current transitional package name for
a sanitized import of the AubOS Factory implementation lineage. Its historical
names, receipts, and compatibility contracts remain immutable evidence. The
package is migration material for Vorton Factory, not the final product
boundary and not a permanent external authority.

Factory adopts a narrow installation-module interface before the remote module
catalog is complete. It may remain compiled with Vorton for the first FreedOS
milestones. This avoids delaying Factory while preserving the path to an
independently upgradable module.

## Current status

The committed release still exposes a transitional read-only connector
boundary and lacks the complete shared-workspace execution contract. This
document states the accepted destination. It does not claim that governed
execution, workspace activation, emergency stops, or independent Factory
upgrades are already delivered.
