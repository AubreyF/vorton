# Memory architecture

Vorton separates organizational authority from remembered context. Postgres and immutable source records answer what was decided, approved, assigned, and observed. The memory system helps workers retrieve, connect, consolidate, and reflect on that material.

## Components

### Source store

Canonical source material retains its native identity and revision. Small structured material may live in Postgres. Large transcripts and artifacts may live in object storage. Every source has installation ownership, provenance, classification, timestamps, revision hashes, and deletion state.

### Context Gateway

The Context Gateway is the only application path into memory services. It:

- admits or rejects memory candidates;
- preserves citations to canonical sources;
- labels personal, organizational, mixed, and quarantined material;
- chunks and indexes admitted material;
- routes retrieval to the correct installation memory bank;
- records consolidation lineage;
- propagates deletion and supersession; and
- returns retrieved text as untrusted context.

The gateway is a narrow broker, not a second organizational ledger.

### Hindsight

Hindsight provides the derived-memory engine. The MVP retains source chunks, builds local semantic indexes with the pinned `BAAI/bge-small-en-v1.5` model, and combines semantic and keyword retrieval with reciprocal-rank fusion. Hindsight's native `openai-codex` provider performs fact extraction, observations, and automatic consolidation with strict structured output. Global and consolidation model settings are explicit and serialized. Retain and reflect cannot override the provider, model, or backend.

The Vorton adapter accepts a native observation only when Hindsight returns every supporting fact and each fact is active, document-bound, scoped to the installation realm, and backed by matching Vorton citations and source revision IDs. Missing, truncated, mismatched, or invalidated lineage drops that observation while preserving valid raw facts as fallback. Hindsight reflect text lacks this complete citation envelope, so it remains advisory narrative and cannot become cited evidence. No Hindsight output can create an approval, decision, Policy, capability grant, or Work assignment.

Hindsight classification metadata is transport-only and untrusted. Provider egress rehydrates active admitted source revisions and exact citation tuples from person-scoped Postgres, derives the most restrictive classification, and only then applies the worker ceiling.

Hindsight uses a dedicated persistent `CODEX_HOME`. Its rotating `auth.json` must never be shared with the executive worker or another Hindsight Machine. Model credentials are seeded into that private volume, not stored as Fly secrets or application configuration. Local embeddings and RRF do not receive provider credentials. Hindsight's `openai-codex` provider is its upstream subscription integration and calls the ChatGPT backend directly. It is not an OpenAI-supported Hindsight API, so a real retain, consolidation, and cited-observation canary remains mandatory.

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

Vorton surfaces a derived observation only when it can reconstruct links to every source revision used to produce it. Superseded sources remain historically traceable. Deleted sources are removed from active retrieval, and Hindsight invalidates or rebuilds affected observations from their remaining sources.

The MVP implements source citations, admission state, Hindsight bank isolation, retrieval receipts, deletion propagation, native observation consolidation, and fail-closed observation hydration. Derived observations remain untrusted context. Promotion into an authoritative Record always requires the typed Vorton authority path. The governed scheduling, review, contradiction, promotion, evaluation, and portability system in the roadmap remains future work. Memory temples, spatial indexing, and richer personal mnemonic structures remain compatible future modules rather than kernel requirements.

## Security boundary

Personal and organizational installations never share a Hindsight bank, database, object-storage bucket, credential, or default retrieval route. Mixed material is quarantined until a person classifies it.

The schema includes role and classification metadata for future memory-policy enforcement. The MVP does not claim that role-based memory boundaries are enforced.

## Installation realm migration

Wave 2 does not infer whether an existing installation is personal or organizational. The migration adds `installations.realm` without a default and leaves existing rows unclassified. An unclassified installation cannot create a source connection or memory bank because every such row requires an installation ID and matching non-null realm.

Before enabling Conversations or memory for an existing installation, an operator must classify it explicitly. This example assigns a reviewed personal installation. Use `organizational` only when that is the reviewed boundary.

```sql
update public.installations
set realm = 'personal'
where id = '<installation-id>' and realm is null;
```

After every installation has been reviewed and assigned, validate the deferred constraint:

```sql
alter table public.installations
validate constraint installations_realm_assigned;
```

New installations must always provide `realm`. Omitting it fails the `installations_realm_assigned` check. Deployment tooling must not guess or derive the realm from names, users, modules, or existing content.
