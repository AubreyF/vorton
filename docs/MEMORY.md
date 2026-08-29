# Memory architecture

AubOS separates organizational authority from remembered context. Postgres and immutable source records answer what was decided, approved, assigned, and observed. The memory system helps workers retrieve, connect, consolidate, and reflect on that material.

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

Hindsight provides episodic and semantic retrieval, consolidation, and reflection. Its output is derived memory. It may suggest a connection or candidate learning. It cannot create an approval, decision, Policy, capability grant, or Work assignment.

### Authoritative Records

Decisions, approvals, Policies, Work, receipts, and outcomes remain canonical Postgres Records. Workers retrieve them through typed application services, not by hoping a vector search remembers the law correctly.

## Consolidation

Memory consolidation is explicit and attributable:

```text
source revision
  -> admitted memory candidate
  -> indexed memory
  -> derived reflection
  -> candidate learning
  -> reviewed promotion or rejection
```

A derived memory retains links to every source revision used to produce it. Superseded sources remain historically traceable. Deleted sources are removed from active retrieval, and their derived memories are invalidated or rebuilt.

The first release implements source citations, admission state, Hindsight bank isolation, retrieval receipts, consolidation lineage, and deletion propagation. Memory temples, spatial indexing, and richer personal mnemonic structures remain compatible future modules rather than kernel requirements.

## Security boundary

Personal and organizational installations never share a Hindsight bank, database, object-storage bucket, credential, or default retrieval route. Mixed material is quarantined until a person classifies it.

The schema includes role and classification metadata for future memory-policy enforcement. The first release does not claim that role-based memory boundaries are enforced.
