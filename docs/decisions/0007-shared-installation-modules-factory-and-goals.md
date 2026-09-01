# ADR 0007: Shared installation modules, Factory, and governed goals

Status: Accepted

Date: 2026-08-31

## Context

Vorton is the reusable product and release line. One flagship Vorton
installation will host logically isolated workspaces, initially FreedOS and
AubOS cloud. The earlier model treated each name as a separate installation
and treated the imported AubOS Factory implementation as an external execution
system. That model is superseded.

The installation is one infrastructure trust domain. It may share Supabase,
Postgres, Fly services, a worker pool, object storage, Hindsight, model
authentication, and backup machinery. Workspace membership and authority
remain explicit and live in PostgreSQL. Infrastructure ownership does not
grant product-level workspace content access. A workspace whose owners require
protection from the installation administrator needs a separate installation.

## Decision

### Identity and presentation

One installation-scoped person and Supabase Auth identity may belong to many
workspaces through explicit `workspace_memberships`. Authentication proves the
person. It grants no workspace membership, capability, approval, or Work.

The flagship deployment uses a neutral canonical Vorton origin. Branded
FreedOS and AubOS entry addresses may request a workspace, but the server
rechecks live membership. A hostname, label, route, cached selection, or theme
never grants or infers authority.

The MVP has no cross-workspace search, Council, Factory queue, memory recall,
or business-data dashboard. Installation health may aggregate infrastructure
status without disclosing workspace content.

### Installation modules

Vorton core owns authentication, installation and workspace identity, the
application shell, module loading, the design system and themes, Policy, Work,
Records, approvals, receipts, service brokers, audit, and lifecycle authority.
Product domains are first-class installation modules.

A module is installed as an immutable version in the installation catalog and
activated separately for each workspace. Public Vorton modules and private
installation-owned modules use the same contract. The selected workspace's
PostgreSQL projection determines its active module surface. Interface hiding
does not authorize a module request.

The module contract covers identity, compatibility, routes, navigation,
commands, service requirements, capabilities, schema migrations, jobs, tools,
skills, storage, backup, recovery, deletion, and rollback. UI artifacts are
lazy loaded by exact digest through an authenticated, content-addressed,
same-origin route. A module update does not require rebuilding the Vorton
shell.

Independently deployable does not mean permanently allocated infrastructure.
The default backend uses a shared module host and worker pool. Supervised
module processes receive signed, expiring workspace context and narrow broker
APIs. They receive no ambient installation-wide database credential or secret.
A dedicated service is an exceptional execution profile approved for a
specific workload.

Factory and Goals adopt a narrow internal module boundary before the remote
artifact loader is complete. They may remain compiled with Vorton initially.
This preserves the final module contract without delaying the highest-priority
product work.

### Modules, plugins, tools, and skills

A module is a coherent product domain with interface, records, workflows, and
lifecycle. A plugin is an executable integration or extension used by Vorton
or a module. A tool is a typed callable operation. A skill is versioned
instruction and reference material for a worker. A module may ship plugins,
tools, and skills, but installation or loading grants none of them authority.

Third-party plugin interfaces are outside the current scope. Imported skills
remain separately versioned, inspected, and gated. Roles are skills and grant
no authority.

### Factory

The current AubOS Factory implementation becomes Vorton's first-party
`Factory` module. Factory is the software factory for every workspace where it
is activated. FreedOS activates Factory first. There is no permanent external
Factory control plane or claim service.

Factory owns dispatch claims, custody epochs, checkpoints, handoffs, stale
claim reconciliation, recovery, publication coordination, and execution
receipts under Vorton Work, Policy, capabilities, approvals, and Records.
Existing AubOS Factory behavior is migration source and compatibility code for
the module, not a separate authority to preserve indefinitely.

GitHub remains external repository infrastructure and may remain authoritative
for repository facts such as issues, commits, branches, pull requests,
reviews, and checks. A GitHub connector observes and changes those facts only
through declared Factory capabilities. `githubAppInstallationId` is separately
named and never substitutes for the Vorton installation or workspace.

FreedOS receives real read-only Factory visibility first, followed immediately
by governed execution. Every envelope, durable object, cache key, job, host
path, and receipt carries `vortonInstallationId` and `workspaceId`. Governed
execution requires idempotent admission, explicit Work and capability,
conflict denial, recoverable custody, and workspace and installation emergency
stops.

### Goals and Executive Council

Goals is a first-party module. It owns immutable goal versions,
current-version pointers, hierarchy, owner, intent, success criteria, horizon,
milestones, review cadence, evidence, state, supersession, and retirement.
Executive Council is a separate module that depends on the Goals service and
the Work and Records kernel.

The Council may apply bounded, reversible updates without a person approving
each one. It may reconcile evidence, assess progress, confidence, health, and
blockers, change review dates, maintain milestones within the approved goal,
reorder tactics within an approved strategy, and create proposed Work.

The Council may not automatically change fundamental intent, materially change
success criteria, change the accountable owner, approve spending, make an
external commitment, retire or delete a goal, promote proposed Work into
externally effective execution, or weaken Policy. Those transitions require
the authority declared by workspace Policy. Every automatic change creates an
immutable goal version with evidence, rationale, the Council run, and an exact
diff.

Council input is explicitly admitted, workspace-scoped evidence. The first
goal-management milestone does not depend on production Hindsight recall.
Tools remain disabled during deliberation. The shared ChatGPT authentication
cache may process explicitly admitted confidential material from AubOS and
FreedOS, but every contribution uses an isolated ephemeral session and
workspace-scoped prompt construction, egress Policy, classification, budget,
logs, and receipts.

### Events, upgrades, and recovery

Asynchronous module, Factory, and Council work uses a PostgreSQL transactional
outbox, at-least-once delivery, immutable workspace-scoped event identities,
idempotent consumers, expected-version checks, visible dead-letter state, and
bounded replay. Exactly-once marketing language is prohibited.

Shared database releases are rehearsed in an ephemeral staging installation.
Core and module migrations use expand-first and contract-later sequencing.
Before a shared release, the installation creates an all-workspace backup and
proves isolated recovery. Whole-installation point-in-time recovery is for
catastrophic failure. Ordinary recovery uses workspace and module logical
backups and restores into an isolated namespace first.

### AubOS modules and data

The private AubOS repository owns AubOS-specific modules such as Finance. It
contains module code, schemas, migrations, tools, skills, and migration
contracts, never production personal records. Authoritative module state lives
in workspace-scoped Postgres; large immutable sources live in encrypted object
storage; Hindsight is derived memory; provider credentials remain secret
references.

AubOS cloud receives real data one approved module at a time and no synthetic
production records. AubOS local remains usable until each module is accepted.
After cutover, the local route and links remain and the page body becomes the
exact text `Moved to cloud.`

All existing AubOS themes are already Vorton themes. AubOS ships no custom
theme for MVP. Workspace-provided themes remain a later option.

## Priority

Implementation priority is:

1. FreedOS Factory read-only operational visibility.
2. FreedOS Factory governed execution.
3. Executive Council management of long-term goals in organizational
   workspaces.
4. The general independently upgradable installation-module platform.
5. AubOS cloud migration, one real module at a time.

## Open implementation contracts

This decision fixes the product and authority boundaries. It does not invent
the following lower-level contracts:

- the Module SDK API, compatibility negotiation, and interface contribution
  schema;
- the module signature format, publisher-key lifecycle, and private artifact
  registry;
- the neutral production hostname and the repository that owns the flagship
  installation's nonsecret desired state;
- the exact forward migration of current Factory claim, custody, checkpoint,
  and receipt state into workspace-scoped PostgreSQL authority;
- the typed fields, numeric bounds, and concurrency policy for automatic Goals
  updates; and
- the retirement plan for dedicated FreedOS resources after the shared
  installation has passed cutover and recovery proof.

Each contract requires its own reviewed decision and executable acceptance
proof. None blocks the documentation correction, and none may be inferred from
this ADR.

## Consequences

- Earlier documents that call FreedOS or AubOS separate Vorton installations
  require correction.
- Earlier documents that preserve an external Factory authority describe a
  transitional implementation and require correction or a historical label.
- Current validators, deployment profiles, and release artifacts may still
  enforce the old model. Documentation of this decision does not make those
  artifacts compatible or authorize deployment.
- The Freed application repository is outside this architecture work. The
  private FreedOS repository may carry workspace migration documentation and
  reviewed desired state.
