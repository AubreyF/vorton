# Roadmap

Machine time estimates assume parallel Codex implementation tasks and available cloud credentials. They are planning ranges, not elapsed promises.

## Wave 0: repository and contracts

Target machine time: one conversation, about 30 to 60 minutes.

- [x] Initialize the sanitized AubOS repository.
- [x] Define kernel concepts, package boundaries, security rules, installation ownership, and upgrade contracts.
- [x] Add contract schemas, a minimal CLI, synthetic fixtures, CI, and immutable release identity.
- [x] Produce a clean baseline commit suitable for parallel worktrees.

## Wave 1: runnable kernel

Target machine time: three parallel conversations, about 90 to 180 minutes each.

- [x] Supabase migrations, Auth integration, RLS, People, Workers, Roles, Work, Policy, and Records.
- [x] Fly-hosted control plane shell, module navigation, worker status, Work views, blank Tools, Tool Lab, and Moonbase Triage preview.
- [x] Installation init, manifest and lock, release manifest, plan and apply, org image build, Fly deployment contract, and upgrade proof.

Milestone: a local AubOS control plane can authenticate a synthetic owner, create and inspect Work, show synthetic workers, and preview Moonbase Triage.

## Wave 2: useful FreedOS

Target machine time: three parallel conversations, about 120 to 240 minutes each.

- [x] Executive roles, recommendations, approvals, decisions, dispatch, and outcome review.
- [x] Context Gateway, Hindsight adapter, memory consolidation contracts, Meet and Omi polling adapters, transcript provenance, and deletion propagation.
- [x] Factory dashboard and read-only connector to the existing Freed Linux pilot.

Milestone: FreedOS can run in the cloud as an executive copilot, preserve governed memory, and show current Factory work without becoming the Factory pilot's authority.

## Wave 3: release and proof

Target machine time: one integration conversation, about 120 to 240 minutes plus CI and deployment waits.

- [x] Run security, RLS, migration, worker-protocol, and acceptance verification.
- [x] Create the private FreedOS installation repository.
- [ ] Deploy the FreedOS control plane and first worker path on Fly with isolated Supabase and Hindsight resources.
- [x] Publish the first immutable AubOS release with digest-pinned images, registry evidence, deterministic contracts, checksum, and SPDX SBOM.
- [ ] Upgrade FreedOS to the next release and prove configuration, application, and database recovery boundaries.

Milestone: AubOS has a reproducible release and FreedOS is live for owner testing.

## Later

- Enforced role-based memory boundaries.
- Additional frontier and local worker providers.
- M5 native validation and aggressive diagnosis worker.
- Multi-tenant hosting, module registry, signed packs, budgets, and policy simulation.
- Rich transcript backfills, raw-media workflows, and additional conversation providers.
