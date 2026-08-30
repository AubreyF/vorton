# Roadmap

This roadmap separates the durable product direction from the work currently underway. Completed foundations describe what exists in the repository. They do not imply that Vorton is ready for sensitive or production use.

## Long-term direction

Vorton is intended to become a modular operating system for a person or organization. Each installation should coordinate people, AI workers, knowledge, software, tools, and infrastructure without surrendering control to one model provider or execution host.

The mature system should provide:

- one governed kernel for identity, policy, work, decisions, approvals, and evidence;
- a control plane for personal and organizational operations;
- portable roles expressed as skill files that workers can inherit;
- workers distributed across cloud services, local machines, and isolated environments;
- cited memory with consolidation, contradiction handling, review, and selective forgetting;
- Factory as the software-production module of the same operating system;
- installation-owned modules, tools, integrations, and workflows; and
- deterministic installation, upgrades, rollback, and recovery.

## Work in progress

### First live installation

- [ ] Complete and verify the isolated deployment of the control plane, API, workers, database, storage, and memory service.
- [ ] Validate sign-in, authorization, Work creation, worker dispatch, receipts, and review as one complete flow.
- [ ] Run a real retain, consolidation, retrieval, and citation canary.
- [ ] Prove application, configuration, and database recovery during an upgrade.

### Factory pilot

- [ ] Display live tickets, workers, claims, pull requests, checks, blockers, and recovery state.
- [ ] Reconcile external ticket state with Vorton Work without inventing a second queue.
- [ ] Validate the read-only connector before approving authority-changing operations.
- [ ] Generalize proven connector behavior without adding pilot-specific policy to the kernel.

### Release hardening

- [ ] Publish the first Vorton release with a tested upgrade edge from the immutable 0.3.2 legacy release.
- [ ] Retain historical manifests, migrations, database roles, and protocol keys until a forward migration proves replacement and rollback.
- [ ] Exercise installation from a clean consumer repository.
- [ ] Verify exact rollback after successful and interrupted upgrades.
- [ ] Complete full Supabase Auth, API, Realtime, storage, and Row Level Security validation.
- [ ] Replace pre-alpha assumptions with explicit compatibility and support contracts.

## Delivered foundations

These capabilities exist but remain subject to integration testing and change:

- PostgreSQL schemas for People, Workers, Roles, Work, Policy, and Records.
- Supabase Auth integration, Row Level Security, short-lived worker credentials, and append-only records.
- A web control plane with Work, worker, executive, memory, conversation, and Factory foundations.
- A blank Tools module with scaffolding and the uninstalled Moonbase Triage example.
- A provider-neutral Context Gateway, Hindsight adapter, source citations, transcript revisions, retrieval receipts, and deletion propagation.
- Google Meet and Omi adapter foundations for high-volume conversation ingestion.
- Worker registration, capability advertisement, leasing, status, dispatch, and evidence contracts.
- A read-only Factory connector boundary for external software queues and execution systems.
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
- Personal and organizational profiles with isolated credentials, databases, memory banks, and storage.

### Workers, modules, and distribution

- More frontier providers, local model runtimes, and specialized diagnostic workers.
- Containerized research and operational workers beyond software development.
- Complete Finance, Conversations, Tasks, Goals, Opportunities, Command Bridge, Tools, and Factory modules.
- Rich transcript backfills, raw media workflows, and additional conversation providers.
- A signed module and tool registry, followed by a managed deployment model once isolated installations prove the security contract.

## Rules that do not move

- Memory supplies context but never grants authority.
- Roles describe how to work. Policy and explicit Work determine what a worker may do.
- Factory uses kernel Work and Records rather than creating a separate organizational ledger.
- External systems retain authority wherever a connector contract says they do.
- Personal data, organization data, credentials, and deployment resources remain isolated by installation.
- Checkboxes record verified evidence, not aspiration.
