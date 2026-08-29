# ADR 0002: Authority and memory boundary

Status: Accepted

## Decision

Postgres Records are canonical for decisions, approvals, Policies, capabilities, Work, receipts, and outcomes. Hindsight stores derived memory and reflection behind the Context Gateway. Retrieved memory is untrusted context and grants no authority.

Personal and organizational installations use separate databases, storage, secrets, and Hindsight banks. Role-based memory fields ship as scaffolding in the first release, but enforcement is deferred until an adversarial security milestone.

## Consequences

- Memory consolidation preserves source citations and lineage.
- Deletion and supersession propagate into indexes and derived memories.
- A conversation statement cannot silently authorize an action.
- The application does not depend on Hindsight availability to determine what was approved.
- Future memory engines can implement the gateway contract without rewriting organizational authority.
