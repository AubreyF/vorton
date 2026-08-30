# Factory module

Factory coordinates software work through the Vorton kernel. It does not create a sibling platform, member model, memory system, or organizational ledger.

## Authority split

GitHub Issues may remain the canonical human queue for software tickets. Repository-specific claim, lease, validation, draft publication, and recovery machinery remains authoritative for execution where the connector declares it.

Vorton owns organizational intent, Policy, decisions, approvals, Work relationships, worker inventory, executive recommendations, cross-module memory, and the control-plane view. The Factory connector reconciles those records with the software queue and execution system.

For each linked ticket, the connector records:

- installation Work ID and repository ticket ID;
- which system owns each state transition;
- current claim or lease witness;
- worker, host, provider, and model;
- branch, pull request, exact source head, and checks;
- publication authority and draft or ready state;
- receipts, blockers, recovery state, and final outcome; and
- last successful reconciliation cursor.

Conflicting claims fail closed and appear in the control plane. The connector never resolves an authority conflict by choosing the freshest timestamp.

## Freed pilot

The existing Freed Linux pilot remains the sole launch lane for its first ticket. Its GitHub Issues, task claims, lease machinery, provider policy, and draft publication are the current Freed adapter and compatibility boundary.

Initial FreedOS integration is read-only. It displays open tickets, worker activity, claims, draft pull requests, checks, blockers, and recovery state. It does not create a new queue, change live authority, contact providers, or publish code.

Later write integration requires an explicit connector contract and separate owner approval for each authority-changing operation.
