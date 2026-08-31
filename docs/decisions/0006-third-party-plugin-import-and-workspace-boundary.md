# ADR 0006: Third-party plugin import and workspace boundary

Status: Proposed

## Context

Vorton intends to support OpenClaude- and Paperclip-inspired plugins without importing their ambient host authority assumptions. A plugin may contain instructions, reference files, scripts, tools, connectors, jobs, or user interface extensions. Installation of an artifact and permission to use it are separate decisions.

Vorton authenticates a person at the installation level. Live PostgreSQL `workspace_memberships` determine which workspaces that person may enter. Provider identity proves identity only. It grants no workspace membership, plugin activation, capability, or authority.

The transitional Freed connector already uses `installationId` for a GitHub App installation. That external provider identifier is not a Vorton organizational installation. The single pilot connector predates the multi-workspace contract and does not prove workspace isolation.

## Decision

Vorton may store a signed or content-addressed plugin artifact in an installation-scoped catalog. Each activation and all configuration, capability grants, secrets, storage, jobs, memory access, worker actions, events, logs, receipts, exports, and audit records are workspace scoped. A future installation-level component requires a separate, narrow contract and cannot reuse workspace authority by implication.

Every plugin runtime request and durable plugin record must carry both `vortonInstallationId` and `workspaceId`. The trusted dispatcher resolves those identifiers from authenticated server state and current PostgreSQL membership. External provider identifiers use separate types and names such as `githubAppInstallationId`. They never substitute for Vorton tenancy or grant Vorton authority. The plugin cannot choose, infer, remember, or override the active workspace. A plugin contract that cannot represent both Vorton identifiers, or that overloads them with a provider identifier, is incompatible and must fail closed.

Roles describe competence and grant no plugin authority. A plugin receives only the capabilities assigned to the current Work in the named workspace. Admission and every privileged transition check live workspace membership and revocation state. Dangerous actions require an explicit capability and recent AAL2 step-up authentication when Policy requires it. Workspace-specific identity federation may resolve to the same installation-scoped person, but federation never creates workspace membership.

Third-party bundles enter quarantine as immutable versions with source, digest, license, files, requested capabilities, and analyzer findings. Instructions and read-only resources may run in recommendation-only mode. Scripts, installers, tools, connectors, and browser or network behavior require reviewed runtime adapters.

Plugin code runs outside the Vorton host in an ephemeral isolated worker with no ambient credentials, database access, memory access, network, host filesystem, shared cache, or event subscription. Vorton supplies selected inputs and an empty output boundary. External effects pass through typed brokers that check the installation, workspace, Work, Policy, capability grant, approval, destination, and limits. Brokers use short-lived secret handles rather than exposing provider credentials to plugin code.

Workspace scope must survive every asynchronous boundary. Cache keys, job payloads, queues, filesystem paths, object keys, event topics, logs, receipts, exports, and cleanup operations include and validate both identifiers. Missing, stale, mismatched, or unauthorized scope blocks the operation.

The control plane presents three modes: Advise, Draft, and Act. Imported plugins start in Advise. Activation shows the exact workspace, data classes, connectors, destinations, and effects requested. Updates create new immutable versions and require review when permissions change. Receipts show the plugin version, workspace, inputs, broker decisions, outputs, and external effects.

## Consequences

- Installing a plugin does not activate it in any workspace.
- Switching workspaces requires a live membership check and produces no inherited plugin authority.
- A shared credential, cache, job runner, or event bus must preserve Vorton installation and workspace scope at every read and write.
- Provider installation identifiers remain separately typed and grant no Vorton workspace authority.
- The Freed pilot connector is transitional compatibility, not evidence that the plugin contract enforces multi-workspace isolation.
- Static and semantic scanners inform review but cannot authorize activation or execution.
- Revoking an activation or capability stops future use without deleting historical receipts.
- Installation-level plugins remain unsupported until a separate contract defines their narrow authority and isolation requirements.
