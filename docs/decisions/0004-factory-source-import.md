# Decision 0004: Import Factory as a connector, not a second platform

Status: Superseded by ADR 0007

This decision records the historical source import that protected the first
pilot. Its permanent external-authority interpretation is superseded. Vorton
imports the proven AubTown implementation as migration source for the
first-party Factory module.

During the historical read-only phase, the imported connector retained
Freed-specific broker, workspace, claim, readiness, and lifecycle policy. The
approved destination is one Vorton Factory module that owns those execution
semantics under workspace-scoped Vorton authority. There is no permanent
external Factory or claim service.

The import uses the exact clean AubTown main head `014b786c8bf6b51a3ed265b4e36773afff0f5d59`. It excludes Git history and every mutable or secret-bearing path. Historical AubTown pull requests 4 and 9 are not imported because they predate the deployed main line.

Historical Nova Prime names, paths, signed domains, and receipts remain
unchanged evidence. New contracts use Vorton Factory, explicit Vorton
installation and workspace identities, and separately named provider
identifiers.
