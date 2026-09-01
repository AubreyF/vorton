# Roadmap

This roadmap separates the durable product direction from the work currently underway. Completed foundations describe what exists in the repository. They do not imply that Vorton is ready for sensitive or production use.

## Long-term direction

Vorton is intended to become a modular operating system for people and
organizations. Each installation is one infrastructure trust domain containing
one or more logically isolated workspaces.

The mature system should provide:

- one governed kernel for identity, policy, work, decisions, approvals, and evidence;
- multiple logically isolated workspaces within one installation, allowing environments such as AubOS and FreedOS to share physical infrastructure while retaining separate authority, memory, secrets, storage, workers, events, and audit trails;
- a control plane for personal and organizational operations;
- portable roles expressed as skill files that workers can inherit;
- workers distributed across cloud services, local machines, and isolated environments;
- cited memory with consolidation, contradiction handling, review, and selective forgetting;
- Factory as the first-party software-production module for every workspace
  where it is activated;
- independently released installation modules activated per workspace;
- installation-owned modules, tools, integrations, and workflows; and
- deterministic installation, upgrades, rollback, and recovery.

Vorton separates modules, plugins, tools, and skills. Modules are coherent
product domains. Plugins are executable integrations used by core or a module.
Tools are typed callable operations. Skills are instructions and references
that grant no authority. Immutable distribution, supervised execution, and
explicit capability gates let installations extend Vorton without permanent
source forks. Third-party plugin interfaces are outside the current scope.

## Work in progress

### 1. FreedOS Factory visibility

- [ ] Bind every Factory envelope and persisted object to the exact Vorton
      installation and FreedOS workspace.
- [ ] Display real tickets, Work, workers, claims, custody, pull requests,
      checks, blockers, freshness, and recovery state.
- [ ] Preserve GitHub repository facts without treating it as another Factory
      control plane.
- [ ] Prove phone and desktop workspace selection and cross-workspace denial.

### 2. FreedOS Factory governed execution

- [ ] Move the existing AubOS Factory claim, custody, checkpoint, handoff,
      recovery, and publication behavior behind Vorton module authority.
- [ ] Require exact Work, Policy, capability, idempotent admission, conflict
      denial, and immutable execution receipts.
- [ ] Provide workspace and installation emergency stops.
- [ ] Prove response-loss replay, stale-custody recovery, handoff, and rollback.

### 3. Organizational goals and Executive Council

- [ ] Deliver immutable long-term goal versions in the Goals module.
- [ ] Let each organizational workspace run an isolated Executive Council over
      explicitly admitted evidence.
- [ ] Apply bounded updates to evidence, progress, health, review dates,
      milestones, tactics, and proposed Work.
- [ ] Require governed authority for intent, material success criteria,
      ownership, spending, external commitments, retirement, deletion, and
      externally effective execution.

### 4. Independently upgradable installation modules

- [ ] Publish the Module SDK, immutable release manifest, installation catalog,
      and workspace activation contract.
- [ ] Lazy load exact UI artifacts through authenticated same-origin paths.
- [ ] Run custom logic in a shared supervised module host and worker pool.
- [ ] Prove module backup, schema expansion, staged activation, rollback, and
      data-preserving deactivation.

### 5. AubOS cloud migration

- [ ] Create the empty AubOS cloud workspace only after release adoption and
      workspace-birth authority are accepted.
- [ ] Migrate real data one module at a time, beginning with Tasks.
- [ ] Keep AubOS local usable until each module is accepted and cut over.
- [ ] Populate no synthetic records in the production AubOS workspace.

### Release hardening

- [ ] Publish the first Vorton release with a tested upgrade edge from the immutable 0.3.2 legacy release.
- [ ] Retain historical manifests, migrations, database roles, and protocol keys until a forward migration proves replacement and rollback.
- [ ] Exercise installation from a clean consumer repository.
- [ ] Verify exact rollback after successful and interrupted upgrades.
- [ ] Complete full Supabase Auth, API, Realtime, storage, and Row Level Security validation.
- [ ] Replace pre-alpha assumptions with explicit compatibility and support contracts.

## Delivered foundations

These capabilities exist but remain subject to integration testing and change:

Memory delivery is intentionally narrow. Production Hindsight recall, retain, consolidation, invalidation, receipts, retention, and deletion remain disabled and unwired.

- PostgreSQL schemas for People, Workers, Roles, Work, Policy, and Records.
- Supabase Auth integration, Row Level Security, short-lived worker credentials, and append-only records.
- A web control plane with Work, worker, executive, memory, conversation, and Factory foundations.
- A blank Tools module with scaffolding and the uninstalled Moonbase Triage example.
- PostgreSQL authority projections for workspace-scoped memory banks and admitted source material, plus a test-only in-memory Context Gateway mutation harness.
- Google Meet and Omi adapter foundations for high-volume conversation ingestion.
- Worker registration, capability advertisement, leasing, status, dispatch, and evidence contracts.
- A transitional read-only Factory connector boundary and imported AubOS
  Factory implementation lineage. This is not the final authority model.
- Deterministic initialization, content-addressed upgrades, conflict detection, and exact rollback.
- Immutable release manifests, digest-pinned images, checksums, registry evidence, and software bills of materials.

## Later investments

### Governed memory

- Vorton-owned scheduling, retries, budgets, staged consolidation, and replay.
- Contradiction detection, review, promotion, lineage, invalidation, retention, and selective forgetting.
- Temporal, entity, episode, decision, causal, contradiction, semantic, and lexical indexes.
- Quality, drift, latency, cost, and failure evaluations across frontier and local models.
- Optional spatial and narrative memory views built on the same cited sources.

### Policy and access

- Enforced role and classification boundaries throughout memory and model execution.
- Delegated administration, richer organizational access controls, and policy simulation.
- Phone-friendly workspace selection inside one authenticated environment.
- Optional dedicated physical resources for workspaces whose risk or compliance requirements exceed logical isolation.

### Workers, modules, and distribution

- More frontier providers, local model runtimes, and specialized diagnostic workers.
- Containerized research and operational workers beyond software development.
- Complete Admin, Conversations, Tasks, Goals, Opportunities, Command Bridge,
  Tools, Factory, and Executive Council as first-party installation modules.
- Support installation-owned modules, including private AubOS Finance.
- Rich transcript backfills, raw media workflows, and additional conversation providers.
- A signed module and tool registry with immutable versions, permission review,
  workspace-specific activation, and revocation.
- Brokered plugin effects, short-lived secret handles, recent AAL2 step-up for dangerous actions, and receipts that bind plugin version, installation, workspace, Work, and capability authority.

## Rules that do not move

- Memory supplies context but never grants authority.
- Roles describe how to work. Policy and explicit Work determine what a worker may do.
- Factory is a Vorton module and uses kernel Work and Records rather than
  creating a separate organizational ledger or external Factory authority.
- External systems retain authority wherever a connector contract says they do.
- Provider identity proves identity only. PostgreSQL membership and Policy determine workspace and plugin authority.
- Plugins never infer a workspace or cross workspace boundaries through caches, jobs, credentials, filesystem paths, event subscriptions, logs, receipts, or exports.
- Workspace data, credentials, memory, storage, workers, events, and audit records remain logically isolated inside an installation. Dedicated physical isolation remains available where Policy requires it.
- Checkboxes record verified evidence, not aspiration.
