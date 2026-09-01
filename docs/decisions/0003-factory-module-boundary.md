# ADR 0003: Factory module boundary

Status: Accepted

## Decision

Factory is a first-party Vorton module. It uses kernel Work, Policy, Records,
workers, memory, and control-plane views. The existing AubOS Factory
implementation becomes this module. Factory owns claim, custody, checkpoint,
handoff, recovery, and execution behavior under kernel authority. Repository
connectors preserve external repository facts without becoming a second
Factory control plane.

FreedOS begins with real read-only Factory visibility and proceeds immediately
to governed execution after the module proves its workspace-scoped authority
and recovery contract.

## Consequences

- Legacy factory prototype names remain historical implementation details.
- Factory can span any number of workers and hosts through the worker protocol.
- Research and other non-code workers use the same kernel without being mislabeled as Factory executors.
- Historical pilot identifiers and receipts remain immutable compatibility
  evidence during migration.
- ADR 0007 clarifies the shared-installation destination.
