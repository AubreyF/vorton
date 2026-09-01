# Installation modules

Installation modules are Vorton's independently versioned product domains.
They inherit the Vorton shell, design system, themes, API surface, kernel
authority, brokers, audit, and lifecycle machinery.

## Status

This document defines the accepted target architecture. Current main provides
governed workspace selection and a PostgreSQL-derived projection over statically
compiled module definitions. It does not yet provide the installation catalog,
signed independent artifacts, lazy interface loader, supervised module runtime,
or independent module upgrade lifecycle described below.

## Install once, activate per workspace

A module release enters an installation-scoped catalog as an immutable,
digest-pinned artifact. Installation admission does not activate it. An exact
version is activated separately for each workspace through PostgreSQL
authority.

The workspace bootstrap returns only the selected workspace's active module
projection. The shell uses that projection for navigation, routes, commands,
search surfaces, and lazy loading. The server repeats the installation,
workspace, membership, Policy, and capability checks for every request.

Multiple versions may remain installed for rollback. Each workspace has one
active version. The installation maintains one current database schema head per
module, so staged workspace versions must remain compatible with that schema.

## Admission and activation authority

Module admission and workspace activation are separate governed operations.
Admission is installation scoped and binds the exact release digest, publisher,
requested capabilities, migrations, service requirements, security review,
backup plan, and rollback plan. It requires the installation capability and
recent AAL2. The resulting receipt grants no workspace activation.

Activation requires live workspace membership, workspace Policy, an explicit
capability, the exact admitted release, workspace configuration, budgets,
secret references, and any approved data migration. Sensitive activation,
upgrade, deactivation, export, or deletion also requires recent AAL2. A module
cannot admit, activate, configure, or upgrade itself.

## Release set

A module manifest binds one release set:

```text
module release
  manifest and signature
  browser UI artifact
  server artifact
  database migrations
  job definitions
  route and interface contributions
  capabilities and service requirements
  storage and secret-reference declarations
  tools, plugins, and skills
  backup, recovery, deletion, and rollback rules
```

Public Vorton modules use public immutable artifacts. Private installation
modules use private immutable artifacts. Private code never enters the public
Vorton repository merely because the installation loads it.

## Browser loading

UI entry points are served through authenticated, content-addressed,
same-origin paths. The installation catalog, not a workspace-supplied URL,
resolves the exact artifact. Workspace switching:

1. verifies live membership;
2. retrieves the new module projection;
3. cancels requests from the old workspace;
4. changes query, persistence, service-worker, and event namespaces;
5. removes routes not active in the new workspace; and
6. lazy loads only the new workspace's modules.

Client code receives no database or provider credentials. A loaded component
cannot authorize its own API operation.

## Backend execution and cost

Independent release does not imply one always-on service per module. The
default execution profiles are:

| Profile                  | Runtime                               |
| ------------------------ | ------------------------------------- |
| UI only                  | Browser plus existing Vorton APIs     |
| Declarative data         | Shared Vorton API                     |
| Custom synchronous logic | Shared supervised module host         |
| Background processing    | Shared queue and worker pool          |
| Exceptional workload     | Separately approved dedicated service |

Module processes receive a signed, expiring workspace context and narrow
broker interfaces. They receive no ambient installation database credential,
secret store, host filesystem, or unrestricted network. A dedicated service
requires an explicit cost or isolation justification.

## Data and migrations

Module source belongs in its source repository. Production records do not.
Authoritative mutable module state lives in workspace-scoped Postgres. Large
sources and generated artifacts live in encrypted object storage. Hindsight is
derived memory. Secret values remain behind references.

Core and module migrations are separate operations. A module upgrade requires:

- an exact current and target release;
- a module-scoped backup;
- an expand-first schema migration;
- compatibility with the previous runtime during rollout;
- staged workspace activation;
- verification and an immutable receipt; and
- retained prior artifacts and an exact rollback path.

Deactivating or uninstalling code does not delete module data. Retention and
deletion are separate governed lifecycle operations.

## Factory, Goals, and AubOS

Factory and Goals are first-party Vorton modules. They begin behind the final
internal module boundary while compiled with the application. This lets the
highest-priority product milestones proceed before remote artifact loading is
complete.

The private AubOS repository owns modules that are personal by design, such as
Finance. One Finance module may contain many views, workflows, importers,
tools, and skills. It uses Vorton's existing themes and ships no custom theme
for MVP.

## Related artifact types

- A module is a coherent product domain.
- A plugin is executable integration or extension code used by Vorton or a
  module.
- A tool is a typed operation invoked through Vorton authority.
- A skill is instruction and reference material for a worker.

A module release may include or depend on the other artifact types. Their
identities and activation remain distinct, and none grants authority by being
installed or loaded.

Third-party plugin interfaces are outside the current scope.
