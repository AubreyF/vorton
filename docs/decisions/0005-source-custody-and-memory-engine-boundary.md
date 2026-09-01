# ADR 0005: Source custody and memory engine boundary

Status: Accepted

## Context

Early AubOS planning considered making Omi the canonical memory system and using gBrain or MemPalace for missing semantic or episodic capabilities. Vorton now has a different and stronger boundary. Omi is one source adapter. Hindsight is the current derived-memory engine. Neither owns organizational authority or the only durable copy of source history.

## Decision

Vorton owns the canonical source envelope, provenance, admission state, revision history, deletion state, citations, consolidation lineage, and retrieval receipts. Provider-native identifiers remain aliases to that Vorton-owned history. Postgres Records remain canonical for decisions, approvals, Policy, capabilities, Work, receipts, and outcomes.

Admitted source material retains its original fidelity until an explicit retention or deletion policy changes its state. A summary, embedding, extracted fact, or consolidated observation never substitutes for the source revision that supports it. Derived indexes and memories must be rebuildable from canonical source material.

The Context Gateway is the only application path into a derived-memory engine. Hindsight is the first implementation, not a permanent authority. A future engine may replace or complement it only through the gateway contract and must preserve citation, realm, classification, invalidation, and retrieval-receipt behavior.

Any generated output that reenters source or memory ingestion must carry its origin, source lineage, and a stable idempotency identity. Vorton must reject or quarantine a cycle that would repeatedly consolidate its own derived output.

Before sensitive or production use, Vorton must prove a complete export and isolated restore of canonical sources, citations, lineage, invalidations, and engine configuration. Rebuilding derived indexes from that restored corpus is part of the proof. Provider export alone is insufficient.

## Consequences

- Omi remains a valuable conversation and future capture provider, but it is not Vorton's canonical memory authority.
- gBrain and MemPalace remain design references and evaluation comparators rather than required runtime dependencies.
- Exact episodic recall, semantic consolidation, temporal reasoning, entity linking, contradiction detection, and narrative or spatial views can evolve without creating a second authority ledger.
- Cross-source identity must preserve provider aliases while binding Vorton identities for people, projects, episodes, and artifacts to the exact installation and workspace.
- Derived memories should record the engine, model or extractor version, confidence where meaningful, effective time, and supporting source revisions.
- Broad retention does not imply broad access. Realm, classification, participant, workspace, purpose, and Policy constraints apply before retrieval context is assembled.
- External action authority remains separate from memory richness. Remembering a request does not authorize executing it.

## Future screen context

Desktop screen context remains a useful episodic source because it can connect what a person saw and did with conversations, files, calendar events, and other activity. A screen connector must use the same canonical source and gateway contracts. It also requires visible capture state, emergency pause, application and window exclusions, credential and private-context filtering, explicit raw-frame retention policy, OCR and model provenance, and deletion propagation. Screen capture is a source adapter, not a privileged memory authority.
