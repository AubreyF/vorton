# ADR 0006: Plugin, skill, tool, and workspace boundary

Status: Proposed

## Context

Vorton draws useful extensibility ideas from Paperclip and OpenClaw without
implying affiliation, endorsement, or code derivation. Their concepts do not
become one undifferentiated package type inside Vorton.

ADR 0007 defines installation modules as coherent product domains with
interface, records, workflows, and lifecycle. This decision covers the related
but distinct plugin, tool, and skill boundaries. Third-party plugin interfaces
are outside the current scope.

Vorton authenticates a person at the installation level. Live PostgreSQL
`workspace_memberships` determine which workspaces that person may enter.
Provider identity proves identity only. It grants no module activation, plugin
activation, capability, approval, or Work.

## Decision

A plugin is executable integration or extension code used by Vorton or a
module. A tool is a typed callable operation exposed through Vorton authority.
A skill is versioned instruction and reference material for a worker. Roles are
skills. A module may ship or depend on plugins, tools, and skills, but every
artifact retains a separate identity, version, activation state, and receipt
chain.

Installing, activating, or loading an artifact grants no authority. A skill
cannot install executable dependencies, activate a tool, obtain a credential,
create workspace membership, or widen a worker capability. An imported package
that contains executable code enters the plugin review path even when it also
contains a `SKILL.md` file.

Vorton may store signed or content-addressed plugin artifacts in an
installation-scoped catalog. Plugin activation, configuration, capabilities,
secrets, storage, jobs, memory access, worker actions, events, logs, receipts,
exports, and audit records remain workspace scoped.

Every plugin runtime request and durable plugin record carries both
`vortonInstallationId` and `workspaceId`. The trusted dispatcher resolves those
identifiers from authenticated server state and live PostgreSQL membership.
External identifiers use separately named fields such as
`githubAppInstallationId`. They never substitute for Vorton scope or grant
Vorton authority.

Executable plugin code runs in a supervised process or worker with no ambient
database credential, secret store, host filesystem, shared cache, event
subscription, or unrestricted network. Vorton supplies selected inputs and
narrow broker APIs. External effects pass through typed brokers that check the
installation, workspace, Work, Policy, capability grant, approval, destination,
and limits. Brokers use short-lived secret handles rather than exposing
provider credentials.

Workspace scope survives every asynchronous boundary. Cache keys, job
payloads, queues, filesystem paths, object keys, event topics, logs, receipts,
exports, retries, and cleanup operations include and validate both Vorton
identifiers. Missing, stale, mismatched, inferred, or revoked scope blocks the
operation.

Third-party bundles enter quarantine as immutable versions with source,
digest, license, files, requested capabilities, and analyzer findings.
Instructions and read-only resources may be reviewed without activating
executable code. Scripts, installers, connectors, jobs, browser behavior, and
network behavior require reviewed runtime adapters. Static and semantic
analysis informs review but cannot authorize activation.

## Consequences

- A module, plugin, tool, and skill cannot be reinterpreted as another artifact
  type merely to bypass its review boundary.
- Installing an artifact does not activate it in any workspace.
- Switching workspaces requires live membership and inherits no module,
  plugin, tool, or skill authority from the prior workspace.
- Shared credentials, caches, workers, queues, and event buses preserve exact
  installation and workspace scope at every read and write.
- Revoking activation or capability stops future use without deleting
  historical receipts.
- Third-party plugin interfaces remain unsupported until a later decision
  defines their isolation and user-experience contract.
