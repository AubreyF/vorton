# Installation and upstream updates

Organizations own a private installation repository. They configure AubOS without copying or editing the upstream kernel.

## Repository contract

```text
freedos/
  aubos.yaml
  aubos.lock.json
  host/
  organization/
    identity.yaml
    branding/
    roles/
    policies/
    modules.yaml
  modules/custom/
  tools/
  supabase/migrations/organization/
  deploy/
  tests/acceptance/
  .github/workflows/
```

`aubos.yaml` is human-authored desired state. `aubos.lock.json` is generated exact state. It records the AubOS version, source commit, OCI digests, CLI and SDK versions, host contract, module and worker protocols, core migration head, managed-file hashes, and last successful upgrade edge.

The updater may modify only AubOS-managed host adapters and the lock file. Organization identity, roles, policy, branding, modules, tools, deployment configuration, acceptance tests, and organization migrations are organization-owned. Generated plans, journals, and local receipts live under ignored `.aubos/`.

| Path                                                       | Owner        | Update rule              |
| ---------------------------------------------------------- | ------------ | ------------------------ |
| `host/**`                                                  | AubOS        | Exact preimage required  |
| `aubos.lock.json`                                          | AubOS        | Exact preimage required  |
| `aubos.yaml`                                               | Organization | Created only when absent |
| `organization/**`                                          | Organization | Created only when absent |
| `modules/custom/**`, `tools/**`                            | Organization | Created only when absent |
| `supabase/migrations/organization/**`                      | Organization | Created only when absent |
| `deploy/**`, `tests/acceptance/**`, `.github/workflows/**` | Organization | Created only when absent |

The CLI rejects path traversal and symbolic-link escapes. A plan cannot expand updater ownership by declaring a different class in its payload.

## Initial adoption

```bash
aubos init plan --organization Freed
aubos init apply --plan sha256:<plan>
```

Planning is read-only. It lists every path, ownership class, artifact digest, required cloud resource, migration, secret reference, and enabled module. Apply verifies the plan hash and file preimages. It refuses collisions. Creating cloud resources, repositories, or deployments requires a separate explicit operation.

Planning writes only the content-addressed local plan under `.aubos/plans/`. Repeating a plan against the same installation and release produces the same `sha256:` hash. The plan embeds the validated release manifest and exact postimages. Apply reads only that local plan. It performs no fetch, registry lookup, cloud mutation, migration, or deployment.

Apply preflights every action before changing installation files. Its content-addressed journal records each completed action and makes an unchanged retry idempotent. A changed preimage stops the entire apply before the first installation write.

## Updates

```bash
aubos upgrade plan --to v0.2.0
aubos upgrade apply --plan sha256:<plan>
```

The updater opens a normal installation pull request. CI validates schemas, roles, policies, module compatibility, RLS, migrations, a fresh install, an upgrade from the deployed release, organization acceptance tests, worker protocols, and the candidate control plane.

Merging the update pull request authorizes deployment in the first release. Opening the pull request does not. Deployment verifies the lock, checks backup readiness, serializes migrations, deploys exact image digests, verifies health, and records observed deployment identity in Postgres.

Database changes use expand and contract. Schema expansion precedes application rollout. Destructive cleanup occurs only in a later release after old workers are gone.

## Rollback

Configuration rollback reverts the installation commit. Application rollback redeploys the prior recorded image digest. Database recovery uses forward repair or explicit backup restoration. An image rollback never pretends to reverse organizational data.

Before an update is committed, a local receipt may restore only exact updater-owned files whose postimages are unchanged. AubOS never uses broad checkout or clean operations as rollback.

`aubos rollback --plan sha256:<plan>` implements that local receipt rollback. It restores or removes only `host/**` and `aubos.lock.json` entries from the named journal. It refuses rollback if any managed postimage has changed. Organization-owned scaffolding remains in place, including after an initial adoption rollback.

Organizations that modify AubOS core become distributors. They maintain a separate distribution fork, merge immutable upstream tags, build and attest their own images, and point installation locks to those images. Ordinary installations carry no patch queue.

## Release and deployment identity

`release/manifests/<version>.json` binds a release version to a source commit, CLI and SDK versions, protocol contracts, migration head, managed templates, and digest-pinned OCI references. Checked-in Wave 1 manifests are candidates, not published releases. A release uses a dedicated manifest commit because a file cannot contain the hash of its own commit. The release workflow refuses a tag until its manifest is explicitly marked `released` and its source commit equals the tagged manifest commit's first parent.

Fly configuration remains organization-owned. A later deployment operation must consume the exact lock, verify backup readiness, serialize migrations, deploy digest-pinned images, verify health, and record observed identity in Postgres. Application rollback selects an earlier image digest. Database recovery remains a separate forward repair or explicitly authorized restoration.
