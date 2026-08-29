# ADR 0001: Product and repository boundary

Status: Accepted

## Decision

AubOS is the reusable product. FreedOS is one private installation. Factory is a first-party AubOS module. Existing AubTown and FreedTown identifiers remain transitional while the current Linux pilot completes.

The upstream AubOS repository contains product source and immutable release machinery. Each installation repository contains organization-owned configuration and extensions. Installations consume exact artifacts through a manifest and lock. They do not maintain long-lived forks of the product source.

## Consequences

- Personal data and tools cannot enter upstream source or fixtures.
- Factory uses kernel Work, Policy, Records, workers, and control-plane views.
- Runtime records remain in Postgres and object storage rather than Git.
- Upstream updates are bounded, reviewable dependency updates.
- A core-modifying customer assumes distributor responsibilities.
