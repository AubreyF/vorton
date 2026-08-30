# ADR 0001: Product and repository boundary

Status: Accepted

## Decision

Vorton is the reusable product, upstream repository, and release line. FreedOS is the private Vorton installation for Freed. AubOS is the future private Vorton installation for Aubrey's personal life. Factory is a first-party Vorton module. Legacy factory prototype names are not part of the product architecture.

The upstream Vorton repository contains product source and immutable release machinery. Each installation repository contains organization-owned configuration and extensions. Installations consume exact artifacts through a manifest and lock. They do not maintain long-lived forks of the product source.

## Consequences

- Personal data and tools cannot enter upstream source or fixtures.
- Product interfaces, controls, themes, and interaction patterns belong upstream when they can be sanitized without personal data.
- Installation branding is configuration, so Vorton does not hardcode either FreedOS or AubOS into the reusable interface.
- Factory uses kernel Work, Policy, Records, workers, and control-plane views.
- Runtime records remain in Postgres and object storage rather than Git.
- Upstream updates are bounded, reviewable dependency updates.
- A core-modifying customer assumes distributor responsibilities.
