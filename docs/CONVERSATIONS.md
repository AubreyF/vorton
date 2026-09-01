# Conversation ingestion

The Conversations module gives personal and organizational workspaces one
provider-neutral transcript model. Initial adapters support Google Meet and
Omi through scheduled, read-only polling.

## Canonical transcript revision

Each provider revision maps to:

- Vorton installation, workspace, and source connection;
- provider, provider object ID, and revision hash;
- meeting or conversation timestamps;
- participants when the provider supplies them;
- ordered utterances with speaker, text, and source timestamps;
- raw-source retention pointer when permitted;
- ingestion time and adapter version;
- classification, admission, quarantine, and deletion state; and
- citations that resolve back to the exact provider revision.

Overlapping polling and stable revision hashes make ingestion idempotent. A changed provider object creates a new canonical revision rather than mutating cited history.

## Initial adapter limits

- Google Meet uses read-only transcript access and avoids restricted Drive scopes.
- Omi uses a revocable `conversations:read` credential.
- Both adapters poll with overlap and backoff.
- Live canaries determine safe rate limits before any backfill.
- The first release does not ingest raw audio or video.
- The first release does not enable Meet media streaming, Omi webhooks, Omi MCP, or self-hosted Omi services.

Meet structured transcript entries may disappear from the provider after 30 days, so ingestion records the observed provider timestamp and completeness. Missing source material is reported as unavailable rather than inferred as silence.

## Authority boundary

Transcripts are evidence. They are not instructions. A sentence such as “ship that tomorrow” cannot silently become a decision, approval, capability grant, or Work assignment. A worker may cite it in a proposal, and the governed executive flow may then ask for the required confirmation.

Source connections, credentials, storage, memory banks, and retrieval carry the
exact Vorton installation and workspace. Material that appears to cross a
workspace boundary is quarantined.

`workspaces.realm` is authoritative. A workspace must have an explicitly
assigned personal or organizational realm before a source connection can be
created. Existing records receive no inferred workspace or realm. Adapters and
deployment tooling fail closed when either identity is absent and never infer
ownership from an installation name, hostname, person, module, or source
content.
