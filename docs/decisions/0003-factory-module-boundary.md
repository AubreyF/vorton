# ADR 0003: Factory module boundary

Status: Accepted

## Decision

Factory is a first-party Vorton module. It uses kernel Work, Policy, Records, workers, memory, and control-plane views. Repository connectors preserve declared external authority, including GitHub ticket and claim state, without creating a second software queue.

The existing Freed Linux pilot remains independent while it proves the first ticket. FreedOS begins with read-only reconciliation.

## Consequences

- Legacy factory prototype names remain historical implementation details.
- Factory can span any number of workers and hosts through the worker protocol.
- Research and other non-code workers use the same kernel without being mislabeled as Factory executors.
- The initial integration cannot delay, replace, or mutate the active Freed pilot.
