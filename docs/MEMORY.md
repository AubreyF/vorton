# Memory architecture

Vorton separates organizational authority from remembered context. Postgres and immutable source records answer what was decided, approved, assigned, and observed. The memory system helps workers retrieve, connect, consolidate, and reflect on that material.

The durable source-custody and engine-portability rules are recorded in [ADR 0005](decisions/0005-source-custody-and-memory-engine-boundary.md). Omi and other providers supply source material. Hindsight and future engines derive memory behind the Context Gateway. Neither replaces Vorton-owned source history or Postgres authority.

## Delivered foundation

The repository currently provides:

- PostgreSQL authority projections for workspace-scoped memory banks and admitted source material;
- fail-closed bank, source, realm, membership, capability, and classification checks at that database boundary; and
- an in-memory Context Gateway mutation harness enabled only in tests.

Production memory remains disabled. The API does not call Hindsight for recall, retain, consolidation, or invalidation. It does not yet produce durable retrieval, mutation, lineage, retention, or deletion receipts. Source deletion and derived-memory invalidation are also unwired. These are release blockers, not implied capabilities.

## Target architecture

### Source store

Canonical source material retains its native identity and revision. Small structured material may live in Postgres. Large transcripts and artifacts may live in object storage. Every source carries installation and workspace identity, provenance, classification, timestamps, revision hashes, and deletion state.

### Context Gateway

The Context Gateway will be the only application path into memory services. It will:

- admit or reject memory candidates;
- preserve citations to canonical sources;
- label personal, organizational, mixed, and quarantined material;
- chunk and index admitted material;
- route retrieval to the correct workspace memory bank;
- record consolidation lineage;
- propagate deletion and supersession; and
- return retrieved text as untrusted context.

The gateway remains a narrow broker, not a second organizational ledger.

### Hindsight

Hindsight is the planned derived-memory engine. The intended integration retains source chunks, builds local semantic indexes with the pinned `BAAI/bge-small-en-v1.5` model, and combines semantic and keyword retrieval with reciprocal-rank fusion. Hindsight's native `openai-codex` provider can perform fact extraction, observations, and automatic consolidation with strict structured output. Global and consolidation model settings must be explicit and serialized. Retain and reflect must not override the provider, model, or backend.

The future Vorton adapter may accept a native observation only when Hindsight returns every supporting fact and each fact is active, document-bound, scoped to the workspace realm, and backed by matching Vorton citations and source revision IDs. Missing, truncated, mismatched, or invalidated lineage must drop that observation while preserving valid raw facts as fallback. Hindsight reflect text lacks this complete citation envelope, so it remains advisory narrative and cannot become cited evidence. No Hindsight output can create an approval, decision, Policy, capability grant, or Work assignment.

Hindsight classification metadata is transport-only and untrusted. Provider egress must rehydrate active admitted source revisions and exact citation tuples from workspace-scoped Postgres, derive the most restrictive classification, and only then apply the worker ceiling.

A production Hindsight worker must use a dedicated persistent `CODEX_HOME`. Its rotating `auth.json` must never be shared with the executive worker or another Hindsight Machine. Model credentials belong in that private volume, not Fly secrets or application configuration. Local embeddings and RRF must not receive provider credentials. Hindsight's `openai-codex` provider is an upstream subscription integration that calls the ChatGPT backend directly. It is not an OpenAI-supported Hindsight API, so a real retain, consolidation, and cited-observation canary remains mandatory before activation.

### Authoritative Records

Decisions, approvals, Policies, Work, receipts, and outcomes remain canonical Postgres Records. Workers retrieve them through typed application services, not by hoping a vector search remembers the law correctly.

## Consolidation

The target governed consolidation path is explicit and attributable:

```text
source revision
  -> admitted memory candidate
  -> indexed memory
  -> derived reflection
  -> candidate learning
  -> reviewed promotion or rejection
```

Vorton may surface a derived observation only when it can reconstruct links to every source revision used to produce it. Superseded sources must remain historically traceable. Deleted sources must leave active retrieval, and Hindsight must invalidate or rebuild affected observations from their remaining sources.

This production consolidation path is not delivered. Derived observations will remain untrusted context, and promotion into an authoritative Record will always require the typed Vorton authority path. Governed scheduling, review, contradiction, promotion, evaluation, portability, memory temples, spatial indexing, and richer personal mnemonic structures remain future work.

## Security boundary

One Vorton installation may host personal and organizational workspaces on shared physical services. Each workspace has separate authority, membership, memory-bank identity, source namespace, credentials, storage namespace, retrieval route, and audit trail. Database checks enforce this logical boundary. Policy may assign dedicated databases, buckets, workers, or hosts when a workspace needs physical isolation. Mixed material is quarantined until a person classifies it.

The schema includes role and classification metadata for future memory-policy enforcement. The MVP does not claim that role-based memory boundaries are enforced.

## Workspace realm authority

`workspaces.realm` is authoritative for source connections, memory banks, routing, and policy. `installations.realm` remains legacy migration metadata and must not select authority or classify a workspace.

Existing data receives no inferred workspace or realm. An operator must assign each legacy row explicitly. Source connections and memory banks bind to a reviewed workspace through composite installation, workspace, and realm references. Deployment tooling must not derive this assignment from names, users, modules, or existing content.
