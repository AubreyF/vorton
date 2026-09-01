# ADR 0002: Authority and memory boundary

Status: Superseded in part by ADR 0007

The Postgres authority and derived-memory boundary remains accepted. ADR 0007
supersedes the requirement that personal and organizational product identities
must use separate physical installations. One installation may now host
logically isolated personal and organizational workspaces. Each workspace keeps
its own membership, realm, memory bank, source namespace, credential binding,
storage namespace, retrieval route, and audit trail.

## Decision

Postgres Records are canonical for decisions, approvals, Policies, capabilities, Work, receipts, and outcomes. Hindsight stores derived memory and reflection behind the Context Gateway. Retrieved memory is untrusted context and grants no authority.

Personal and organizational installations use separate databases, storage, secrets, and Hindsight banks. Role-based memory fields ship as scaffolding in the first release, but enforcement is deferred until an adversarial security milestone.

## Consequences

- Memory consolidation preserves source citations and lineage.
- Deletion and supersession propagate into indexes and derived memories.
- A conversation statement cannot silently authorize an action.
- The application does not depend on Hindsight availability to determine what was approved.
- Future memory engines can implement the gateway contract without rewriting organizational authority.
