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
