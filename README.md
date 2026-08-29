# AubOS

AubOS is a reusable operating system for people and organizations. It gives humans and AI workers one governed place to understand what matters, propose actions, approve consequential work, preserve evidence, and observe execution across machines and providers.

FreedOS will be the first organizational installation. It is a proving ground, not a special product fork.

## What AubOS owns

AubOS has six kernel concepts:

- **People** authenticate, govern installations, and grant authority.
- **Workers** run bounded jobs on cloud or local infrastructure.
- **Roles** are versioned `SKILL.md` files. A worker loads a role to perform a kind of work well. A role teaches competence but grants no authority.
- **Work** records a requested outcome, custody, state, dependencies, and acceptance evidence.
- **Policy** defines what may happen, who must approve it, and which capabilities a worker may exercise.
- **Records** preserve decisions, approvals, evidence, receipts, outcomes, and supersession history.

The kernel coordinates modules. Initial first-party modules are Command Bridge, Opportunities, Goals, Tasks, Finance, Tools, Conversations, Admin, and Factory. Organizations enable only what they need.

Factory is the software-production module. It uses the same Work, Policy, Records, workers, memory, and control plane as every other module. Existing AubTown and FreedTown code and service names are transitional implementation identifiers for Factory.

## Authority and memory

Postgres is the authority for runtime state. Git stores reviewed code, role definitions, policy definitions, schemas, migrations, and organization configuration. Hindsight stores derived memories and reflections. It does not authorize actions and is never the canonical source for decisions, approvals, policies, or Work.

Every significant claim retains provenance. Conversation transcripts and retrieved memories are evidence, not instructions. They cannot silently become an approval, policy, or task.

Personal and organizational installations use separate Supabase projects, keys, storage, Hindsight banks, and cloud resources. AubOS may expose common interfaces across them, but it does not collapse their security boundaries.

## Distribution

AubOS uses two repositories in normal operation:

1. This upstream monorepo owns the kernel, web control plane, workers, SDK, CLI, first-party modules, core migrations, and release tooling.
2. Each person or organization owns a private installation repository, such as FreedOS. That repository owns identity, branding, roles, policies, enabled modules, custom modules, custom tools, organization migrations, deployment configuration, and acceptance tests.

Installations consume immutable AubOS releases. They do not maintain long-lived source forks. `aubos.yaml` records human intent. `aubos.lock.json` records the exact source commit, image digests, protocol versions, migration head, and managed-file hashes. Updates arrive as reviewable installation pull requests.

See [Architecture](docs/ARCHITECTURE.md), [installation contract](docs/INSTALLATIONS.md), [security model](docs/SECURITY.md), and [roadmap](docs/ROADMAP.md).

## Current status

The repository is in bootstrap. The first deliverable is a locally runnable control plane with Supabase-backed identity and Work, one cloud worker path, governed executive recommendations, blank Tools with the Moonbase Triage example available for preview, and a synthetic read-only Factory fixture.

No personal AubOS data or personal tools belong in this repository. Test fixtures must be synthetic.

## Local development

Prerequisites:

- Node.js 22
- Docker
- Supabase CLI
- Fly CLI for deployment work

Install dependencies and run the repository checks:

```bash
npm install
npm run check
```

Service-specific commands will be added with the first runnable slices. Copy `.env.example` to `.env.local` only for local development. Never commit credentials.

## Inspirations

AubOS draws explicit inspiration from Paperclip, gbrain, and Steve Yegge's Gas City. Paperclip demonstrates an operator-facing AI-company control plane. gbrain demonstrates inspectable, source-cited memory. Gas City demonstrates federated worker topology and composable orchestration. AubOS combines related ideas with its own governed memory, constitutional authority, personal and organizational installations, and integrated Factory module.

These are inspirations, not affiliations, endorsements, or claims of code derivation. AubOS will reserve comparative quality claims for published benchmarks.
