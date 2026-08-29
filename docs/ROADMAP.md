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
- [x] Context Gateway, Hindsight adapter, native observation consolidation profile, Meet and Omi polling adapters, transcript provenance, and deletion propagation.
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

## MVP memory decision: native Hindsight consolidation

The MVP uses Hindsight's native `openai-codex` provider through its own isolated ChatGPT Pro authentication cache. Hindsight owns fact extraction, observations, and automatic consolidation. Local embeddings and reciprocal-rank fusion remain inside the Hindsight boundary. The executive worker uses a different authentication cache, so neither service can impersonate or corrupt the other.

This path deliberately excludes an AubOS-owned consolidation scheduler, promotion queue, and write protocol. Hindsight output remains derived and untrusted. It cannot create organizational authority, and AubOS accepts a cited observation only when it can rehydrate every active source revision and exact citation from Postgres.

## Post-MVP: AubOS-owned memory consolidation cathedral

The full cathedral is the future form of Option Three. AubOS will own a generic consolidation runtime, scheduler, write protocol, review system, and promotion system. That larger system is deliberately deferred until the private MVP produces real operating evidence.

- [ ] Govern consolidation scheduling, retries, cancellation, concurrency, budgets, and owner controls.
- [ ] Admit only active, cited, same-realm source material through explicit source review and quarantine rules.
- [ ] Run staged extraction, reflection, synthesis, and consolidation with durable intermediate evidence.
- [ ] Detect contradictions, preserve competing interpretations, and prevent newer summaries from silently erasing disagreement.
- [ ] Route candidate memories through a review and promotion queue before they can become trusted organizational knowledge.
- [ ] Preserve exact source and parent lineage, idempotent identities, append-only history, and supersession or deletion invalidation.
- [ ] Maintain temporal, entity, episode, decision, causal, contradiction, semantic, and lexical indexes without pretending any index is authority.
- [ ] Govern salience, rehearsal, decay, compaction, retention, legal hold, and selective forgetting as explicit, replayable policy.
- [ ] Offer optional memory-temple views that organize cited material spatially or narratively while preserving the same source and security boundaries.
- [ ] Give operators a consolidation studio for inspecting source packets, intermediate stages, contradictions, lineage graphs, model receipts, and proposed promotions.
- [ ] Instrument quality, latency, cost, failure, drift, and invalidation behavior with replayable evaluations.
- [ ] Keep consolidation portable across Hindsight, Codex, other frontier providers, and future local workers.
- [ ] Enforce role and classification policy at source selection, model execution, retrieval, review, and promotion boundaries.
- [ ] Support personal and organizational memory profiles through one protocol while keeping every realm, credential, bank, database, and object store isolated.

Milestone: AubOS can operate a provider-portable consolidation system whose outputs remain attributable, reviewable, reversible, and subordinate to organizational authority.

## Later

- Enforced role-based memory boundaries.
- Additional frontier and local worker providers.
- M5 native validation and aggressive diagnosis worker.
- Multi-tenant hosting, module registry, signed packs, budgets, and policy simulation.
- Rich transcript backfills, raw-media workflows, and additional conversation providers.
