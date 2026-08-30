# Decision 0004: Import Factory as a connector, not a second platform

Status: accepted

Vorton imports the proven AubTown implementation as `@vorton/factory-connector-freed`. The reusable Factory module remains `@vorton/factory`.

The imported connector retains Freed-specific broker, workspace, claim, readiness, and lifecycle policy. GitHub Issues remain the visible software queue. Freed task claims remain execution authority. Vorton Postgres stores organizational intent and read-only reconciled projections. It cannot grant, duplicate, repair, or retire a Freed claim.

The import uses the exact clean AubTown main head `014b786c8bf6b51a3ed265b4e36773afff0f5d59`. It excludes Git history and every mutable or secret-bearing path. Historical AubTown pull requests 4 and 9 are not imported because they predate the deployed main line.

Nova Prime keeps its current AubTown service names, paths, signed domains, and receipt formats until the first pilot closes. Renaming those identifiers in place would break hashes, signatures, replay keys, or reconciliation evidence. New source and product copy use Vorton Factory.
