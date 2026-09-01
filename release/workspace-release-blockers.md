# Workspace isolation release blockers

Vorton cannot publish a passing `vorton.workspace-isolation-proof.v1` artifact
yet. The local PostgreSQL authority test is useful development evidence, but it
is not the complete release-bound adversarial proof required for a shared
installation.

Current blockers:

- The repository does not yet have the required `.github/workflows/workspace-isolation-proof.yml` producer. Release preparation requires that exact successful GitHub workflow and its non-expired `vorton-workspace-isolation-evidence` artifact. The artifact must index and carry the exact typed test report, typed PostgreSQL authority report, and one distinct typed receipt for each required claim. Caller-controlled environment variables and local proof files do not satisfy this gate.
- Recent AAL2 is enforced for Council installation, approvals, and Work promotion, but no adversarial release proof covers immediate membership revocation plus AAL2 across every sensitive subsystem.
- The Factory reconciliation contract separates Vorton installation,
  workspace, and GitHub App installation identifiers. The current FreedOS
  compatibility path is transitional evidence. It is not an external Factory
  authority and does not prove that the final Factory module isolates every
  workspace activation.
- Memory has no complete adversarial retain, retrieve, delete, and deletion-propagation proof across both workspace realms.
- Worker credentials and jobs have PostgreSQL coverage, but worker logs do not have a complete workspace isolation proof.
- Storage objects and secret bindings do not have workspace-scoped adversarial proof.
- Events, queues, and Realtime do not have workspace-scoped adversarial proof.
- Exports do not have workspace-scoped authority, AAL2, and isolation proof.
- Backup and exact restore do not have cross-workspace confidentiality and integrity proof.
- Audit receipts do not have complete workspace scope, tamper evidence, and replay proof.
- Upgrade and exact rollback do not have a release-bound workspace isolation proof.
- Neutral installation branding, workspace display identity, and presentation-only ingress branding do not have rendered acceptance evidence bound to the release.
- Governed workspace selection and a PostgreSQL-derived projection over
  statically compiled modules exist. Installation catalog admission, signed
  artifacts, lazy UI loading, independent backend execution, deactivation,
  upgrade, rollback, and their release-bound isolation proof do not.

The release remains blocked until every required claim is adversarial,
fixture-only, digest-bound, and produced from a clean GitHub workflow. A private
consumer may impose an additional adoption gate, but no private consumer plan
or proof becomes part of Vorton's public release contract.
