# Architecture

## Design goal

An AubOS installation is one governed system that can span many hosts, providers, and worker types. The control plane stays online in the cloud. Workers connect outward, advertise capabilities, lease Work, and return evidence. Provider credentials remain on the worker host or in its dedicated credential boundary.

```text
Human and agent-facing clients
             |
      AubOS control plane
             |
  Postgres authority and events
             |
     worker coordination
       /      |       \
    Fly     Linux     macOS
  workers   workers   workers
```

## Kernel

The kernel owns People, Workers, Roles, Work, Policy, and Records. Modules use these contracts rather than creating independent identity systems, queues, approval stores, or organizational ledgers.

Roles are skill files. A role may describe jurisdiction, inputs, outputs, methods, review standards, and escalation rules. Policy and explicit Work grant capabilities. Loading a CEO role does not make a worker sovereign, however much the prompt may enjoy the hat.

## Control plane

The web control plane runs on Fly.io. It provides one view of goals, open Work, decisions, approvals, memory provenance, conversations, costs, worker health, and Factory tickets. It uses Supabase Auth and Postgres. Realtime updates drive operational views.

The first release uses one OpenAI Codex worker route. Provider and runtime adapters remain explicit so later workers can use Grok, Claude, local models, or containerized research environments without changing kernel authority.

## Data boundaries

Postgres stores canonical runtime state. Every decision and approval is append-only, attributable, time-bound where appropriate, and superseded explicitly. Object storage holds large source artifacts. Hindsight receives admitted memory material and derived reflections through a Context Gateway.

Hindsight cannot grant authority. Retrieved text is untrusted context. The gateway preserves source identity, citations, classification, admission state, consolidation lineage, and deletion propagation.

Role-based memory filtering is a future enforcement layer. The first release includes classification fields and interfaces but does not claim that role memory boundaries are enforced.

## Modules

- Command Bridge presents the conversational entry point.
- Opportunities tracks possibilities that may merit investigation or promotion.
- Goals tracks desired outcomes and their evidence.
- Tasks is the personal label and view over kernel Work.
- Finance adds financial models and records without weakening approval rules.
- Tools lets an installation define and preview its own tools.
- Conversations ingests provider-neutral transcript revisions from adapters such as Google Meet and Omi.
- Admin manages people, access, policies, integrations, and observed deployment state.
- Factory coordinates software production through kernel Work and external repository connectors.

The upstream Tools module starts empty. It ships scaffolding and one uninstalled, offline example named Moonbase Triage. No personal tools, data, configuration, or assets are copied into AubOS.

## Factory boundary

Factory is a first-party module, not a separate organizational system. GitHub Issues may remain the canonical human software queue while Postgres records organizational Work, approvals, worker state, and receipts. A connector projects and reconciles between them without creating a second software-task authority.

The active Freed Linux pilot remains the launch authority for its first ticket. AubOS consumes its read-only status first. Factory integration cannot delay or replace that pilot.

## Deployment

Supabase provides Postgres, Auth, Row Level Security, Realtime, Queues, and object storage. Fly.io hosts the web control plane, APIs, coordinators, workers, and Hindsight. A separate Vercel deployment is not required for the first release.

Each personal or organizational installation gets isolated Supabase, Fly, storage, secrets, and Hindsight resources. Multi-tenant software may come later, after the isolated-installation model has proven its security contract.
