# Deployment contracts

Release manifests pin every OCI image by digest. Installation-owned Fly configuration consumes those exact references. Tags are descriptive and are never deployment identity.

A deployment operation is separate from `init apply` and `upgrade apply`. It must verify the installation lock, backup readiness, and migration serialization before changing cloud state. It records the observed release, source commit, image digest, and migration head in Postgres after health verification.

Application rollback redeploys the prior observed image digest. It does not reverse migrations or organizational data. Database recovery is a forward repair or an explicitly authorized backup restoration.

The schemas in this directory define the portable OCI identity and Fly deployment request. They contain secret names only. Secret values and runtime receipts never belong in Git.
