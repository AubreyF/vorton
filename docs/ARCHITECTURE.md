# Architecture

## Design goal

Vorton is a governed operating system for people and organizations. One
installation can span hosts, providers, and worker types and can contain many
logically isolated workspaces. An installation is one infrastructure trust,
release, scaling, and catastrophic-recovery boundary. A workspace is the
product identity, membership, authority, data, module-activation, memory,
storage, secret-binding, budget, and audit boundary.

The flagship installation initially contains FreedOS and AubOS cloud. The
installation has a neutral identity and canonical Vorton origin. The selected
workspace supplies the signed-in product identity. Branded entry links may
request a workspace, but the server always resolves live PostgreSQL membership.

```text
People and worker clients
          |
   neutral Vorton origin
          |
  authentication and shell
          |
  workspace membership check
          |
  workspace module projection
          |
  +-------+----------------+
  |                        |
FreedOS                 AubOS cloud
  |                        |
Factory, Goals,          Vorton modules and
Executive Council        private AubOS modules
          \                /
           Vorton kernel
          /      |       \
     Postgres  brokers  worker pool
```

An installation administrator ultimately controls its physical resources. A
workspace whose owners require protection from that administrator needs a
separate installation. Product-level installation authority does not otherwise
grant workspace content access. Emergency access requires an explicit,
time-bound, recently authenticated break-glass path and an immutable receipt.

## Legacy protocol identifiers

Releases through 0.3.2 were published under the former upstream name. Their
manifests, OCI references, migration files, PostgreSQL role names, schemas, and
transaction-context keys remain historical contracts. They are not current
product architecture and must not be rewritten in place. A tested forward
migration replaces them.

## Identity and authority

Supabase Auth establishes one installation-scoped person identity. Explicit
`workspace_memberships` determine which workspaces that person may enter.
Authentication proves identity only. Policy, capabilities, approvals, and Work
determine action authority in the selected workspace.

Every workspace-owned request, row, object, job, event, cache key, log,
receipt, export, backup, and deletion operation carries
`vortonInstallationId` and `workspaceId`. Missing, stale, foreign, inferred, or
revoked scope fails closed. Sensitive actions require recent AAL2 when Policy
declares it.

Roles are versioned skills describing how to work. They grant no authority.
Provider identities and identifiers are separately named and never substitute
for Vorton identity.

## Kernel

The kernel owns People, Workers, Roles, Work, Policy, Records, approvals,
receipts, capability grants, workspace membership, and the transactional event
outbox. Modules use these services instead of creating independent identity,
authority, queue, approval, or audit systems.

Asynchronous work uses at-least-once delivery, immutable event identity,
idempotent consumers, expected-version checks, bounded retry and replay, and
visible dead-letter state.

## Installation modules

Product domains are installation modules. Vorton core owns the shell, module
catalog and loader, design system and existing themes, API gateway, service
brokers, and lifecycle authority.

A module is admitted once as an immutable installation artifact and activated
separately in each workspace. The selected workspace's PostgreSQL projection
determines routes, navigation, commands, search surfaces, and default module.
Direct navigation to an inactive or foreign module fails closed.

The module release binds:

- exact identity, version, publisher, digest, and Vorton SDK compatibility;
- browser UI and server artifacts;
- routes, navigation, commands, and interface slots;
- capabilities, service calls, network destinations, and secret references;
- database schema and migrations;
- jobs, tools, plugins, and skills; and
- backup, recovery, deletion, upgrade, and rollback behavior.

UI artifacts lazy load through authenticated, content-addressed, same-origin
paths. Workspace switching cancels active requests and changes all client cache
and persistence namespaces. UI presence never grants server authority.

Module backends are independently versioned without requiring one permanent
service per module. A shared module host supervises module processes. A shared
worker pool runs queued jobs. Each process receives a signed, expiring
workspace context and narrow broker APIs, not ambient installation-wide
database or secret credentials. Dedicated services are exceptional profiles
for workloads that justify their cost or isolation.

Factory and Goals begin behind a narrow internal module contract while still
compiled with Vorton. Independent remote artifacts follow after the
higher-priority Factory and Council milestones.

## Modules, plugins, tools, and skills

- A module is a coherent product domain with interface, records, workflows,
  and lifecycle.
- A plugin is executable integration or extension code used by Vorton or a
  module.
- A tool is a typed callable operation exposed through Vorton authority.
- A skill is versioned instruction and reference material for a worker.

A module may ship plugins, tools, and skills. Installing or loading any of them
grants no authority. Third-party plugin interfaces are outside the current
scope.

## Data

Postgres stores authoritative runtime and module state. Large or source-faithful
artifacts live in encrypted object storage. Secret values live in dedicated
secret boundaries and appear in records only as typed references. Hindsight
stores derived memory behind the Context Gateway and can never grant authority.

External systems remain authoritative for facts their connector contract
names. Vorton stores attributable observations, normalized state, decisions,
and provenance rather than silently declaring every imported value canonical.

Role-based memory filtering remains future scaffolding and is not an MVP
security claim.

## Factory

Factory is Vorton's first-party software-factory module. The current AubOS
Factory implementation becomes this module. Any workspace may activate it;
FreedOS is the first priority.

Factory owns dispatch claims, custody epochs, checkpoints, handoffs, stale
claim reconciliation, recovery, publication coordination, and execution
receipts under kernel Work, Policy, capabilities, approvals, and Records.
There is no permanent external Factory mechanism.

GitHub remains external repository infrastructure. Its connector observes and,
when governed, changes repository facts such as issues, branches, commits, pull
requests, reviews, and checks. A GitHub App installation identifier is not a
Vorton installation identifier.

FreedOS receives read-only operational visibility first, followed immediately
by governed execution. Historical pilot names and receipts remain compatibility
evidence while their behavior migrates into the module.

## Goals and Executive Council

Goals is a first-party module owning immutable goal versions and the current
projection of intent, success criteria, hierarchy, owner, milestones, evidence,
state, cadence, supersession, and retirement.

Executive Council is a separate module using the Goals service plus kernel Work
and Records. It may automatically apply bounded, reversible updates to
evidence, progress, confidence, health, blockers, review dates, milestones, and
tactics inside an already approved goal. Every update creates a new goal
version with an exact diff and provenance.

Changing fundamental intent, materially changing success criteria, changing
the owner, spending, making external commitments, retiring a goal, promoting
Work into external execution, or weakening Policy requires the authority named
by workspace Policy.

Council deliberation uses explicitly admitted workspace evidence. The first
goal-management milestone does not depend on production Hindsight. A shared
ChatGPT authentication cache may process explicitly admitted confidential
material from AubOS and FreedOS only through isolated ephemeral sessions and
workspace-scoped egress Policy, classification, budgets, logs, and receipts.

## Deployment, upgrades, and recovery

Supabase supplies Postgres, Auth, RLS, Realtime, Queues, and object storage.
Fly hosts the shell, API, shared module runtime, workers, and Hindsight. Sharing
a service never means sharing its workspace namespace.

Core and module upgrades are separate operations. Shared database migrations
are rehearsed in an ephemeral staging installation and use expand-first and
contract-later sequencing. A shared release requires an all-workspace backup,
identity-preservation verification, and isolated recovery proof.

Whole-installation point-in-time restoration is reserved for catastrophic
failure because it rewinds every workspace. Ordinary recovery restores a
workspace or module logical backup into an isolated namespace before any
production change.

## Current implementation status

The approved architecture is ahead of the current release. Existing 0.3.x
installation manifests, deployment profiles, validators, and Factory connector
contracts still encode parts of the former one-realm installation and external
Factory model. Current main provides governed workspace selection and a
PostgreSQL-derived projection over statically compiled module definitions. It
does not yet provide the installation catalog, signed independent artifacts,
lazy interface loader, supervised module runtime, or module upgrade lifecycle.
No source commit alone is release, deployment, or migration authority.
