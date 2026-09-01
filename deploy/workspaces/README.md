# Add a workspace to an existing installation

This generic Vorton operation is separate from first-install bootstrap. It
never creates an installation, person, runtime role, worker, Role, Policy,
Work, Record, memory bank, source connection, provider binding, job, event,
export, backup, module activation, or infrastructure stack.

`npm run workspace:add:plan` prints a deterministic, secret-free `vorton.add-workspace.v1` plan and its SHA-256 digest for any valid personal or organizational workspace. Plan mode performs no database operation and grants no authority. The generic primitive validates identity, authority, exact target fields, and empty birth state without knowing which Vorton product will consume it.

The public Vorton contract does not emit, reinterpret, or authorize a private
workspace-specific migration plan. The source tree still contains historical
`workspace:add:aubos:*` compatibility commands. They are not the approved
generic product boundary and must move behind the private AubOS consumer before
release adoption or personal-data migration.

Release adoption is a separate installation-scoped PostgreSQL approval and
receipt plane. The signed approval binds an exact consumer-verified plan hash
to the complete Vorton release object. PostgreSQL validates and stores the
exact object, requires canonical equality at apply, consumes the approval once,
computes the immutable `vorton.release-adoption-receipt.v1` hash, and records
that adoption changed no installation, workspace, infrastructure, source, or
data state. Workspace birth then binds the exact adoption receipt ID and hash,
manifest, source commit, migration head, proof byte digest, distinct canonical
proof hash, and adoption time.

Before apply, the installation owner records a narrow `workspace.create`
approval through `public.create_workspace_creation_approval`. PostgreSQL
accepts that approval only from a verified Supabase Auth subject with recent
AAL2. Both the ordinary person context and a second context containing the
installation, subject, AAL, and authentication time require transaction-bound
HMAC signatures. Editable database settings or JWT-shaped claims grant
nothing. The approval binds the installation, owner, exact release-adoption
receipt, workspace plan digest, and exact target workspace. This
installation-scoped authority plane exists because a workspace cannot hold its
own creation approval before it exists. It does not inspect or borrow authority
from any existing workspace.

`npm run workspace:add:apply` requires the exact plan digest, approval ID, and a new receipt ID. In one transaction it consumes the approval by writing an immutable installation-scoped receipt, creates the workspace, creates one owner membership, and verifies that every ordinary workspace-scoped table is empty. Replay verifies the immutable receipt and stable workspace birth identity. It does not require the original owner to retain installation or workspace authority forever. Conflicting or unreceipted state fails closed.

This operation does not authorize source reads, data migration, module
installation or activation, cloud mutation beyond workspace birth, or cutover.
A private consumer owns its migration plan and separately approved receipt
chain.
