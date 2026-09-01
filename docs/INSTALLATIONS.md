# Installation and upstream updates

One Vorton installation is a physical deployment and infrastructure trust
domain containing one or more logically isolated workspaces. The flagship
installation contains FreedOS and AubOS cloud. A private flagship configuration
repository should hold nonsecret desired state, exact Vorton release locks,
installed module locks, deployment topology, secret references, and recovery
instructions. Its final repository name is not yet chosen.

Workspace repositories do not control the shared deployment. They own
workspace configuration, Policy, acceptance, and private module source where
applicable. Public and private modules publish immutable artifacts to the
installation catalog and activate separately per workspace. See
[Installation modules](MODULES.md).

The remainder of this document records the current 0.3.x installation updater
and its historical repository contract. It remains necessary for verified
forward migration, but it is not the approved final topology.

## Legacy 0.3.x repository contract

```text
my-organization/
  vorton.yaml
  vorton.lock.json
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

`vorton.yaml` is human-authored desired state. `vorton.lock.json` is generated exact state. It records the Vorton version, source commit, OCI digests, host contract, module and worker protocols, core migration head, managed-file hashes, and last successful upgrade edge. The release manifest and bundled executable bind the CLI version.

The updater may modify Vorton-managed host adapters, the lock file, the desired release-version scalar, recognized Ruby release assertions, and the exact first-party image fields in schema-v2 Fly configurations. Organization identity, roles, policy, branding, modules, tools, app names, regions, other deployment settings, acceptance logic outside those assertions, and organization migrations are organization-owned. Generated plans, journals, and local receipts live under ignored `.vorton/`.

| Path                                   | Owner                   | Update rule                                            |
| -------------------------------------- | ----------------------- | ------------------------------------------------------ |
| `host/**`                              | Vorton                  | Exact preimage required                                |
| `vorton.lock.json`                     | Vorton                  | Exact preimage required                                |
| `vorton.yaml` release-version field    | Vorton release identity | Exact previous value and reviewed postimage required   |
| Other content in `vorton.yaml`         | Organization            | Created only when absent, then preserved byte for byte |
| `organization/**`                      | Organization            | Created only when absent                               |
| `modules/custom/**`, `tools/**`        | Organization            | Created only when absent                               |
| `supabase/migrations/organization/**`  | Organization            | Created only when absent                               |
| `deploy/*.fly.toml` image field        | Vorton release identity | Exact previous image and reviewed postimage required   |
| Other content in `deploy/**`           | Organization            | Preserved byte for byte during image updates           |
| Recognized Ruby release assertions     | Vorton release identity | Exact previous assertions required                     |
| Other acceptance content and workflows | Organization            | Created only when absent                               |

The CLI rejects path traversal and symbolic-link escapes. A plan cannot expand updater ownership by declaring a different class in its payload.

## Legacy initial adoption

```bash
archive_root=/absolute/path/to/unpacked-release
installation_root=/absolute/path/to/private-installation
node "$archive_root/bin/vorton.cjs" init plan \
  --organization "My Organization" \
  --manifest "$archive_root/release/manifests/<version>.json" \
  --artifact-root "$archive_root" \
  --root "$installation_root"
node "$archive_root/bin/vorton.cjs" init apply \
  --plan sha256:<plan> \
  --root "$installation_root"
```

Each contract archive contains a standalone `bin/vorton.cjs` built from the tagged CLI and bundled with its parsing and schema dependencies. It runs with Node 22 without an Vorton source checkout or npm install. The CLI rejects a manifest whose `cliVersion` differs from its embedded version.

The CLI has no implicit release channel or manifest fallback. Planning requires the explicit manifest from that version's archive and the exact unpacked artifact root named by its managed template paths. A real installation must use a manifest marked `released` with registry-backed OCI digests. Test fixtures use `registry.invalid` and never authorize deployment. Schema-v1 manifests remain supported when paired with their exact CLI version. Legacy archives published before the bundled CLI contract require the CLI from their immutable source tag.

Planning lists every path, ownership class, artifact digest, required cloud resource, migration, secret reference, and enabled module. Apply verifies the plan hash and every file preimage. It refuses collisions. Creating a repository, cloud resource, database, secret, or deployment requires a separate explicit operation.

Planning writes only the content-addressed local plan under `.vorton/plans/`. Repeating a plan against the same installation and release produces the same `sha256:` hash. The plan embeds the validated release manifest and exact postimages. Apply reads only that local plan. It performs no fetch, registry lookup, cloud mutation, migration, or deployment.

Apply preflights every action before changing installation files. Its content-addressed journal records each completed action and makes an unchanged retry idempotent. A changed preimage stops the entire apply before the first installation write.

## Legacy whole-release updates

```bash
next_archive_root=/absolute/path/to/unpacked-next-release
installation_root=/absolute/path/to/private-installation
node "$next_archive_root/bin/vorton.cjs" upgrade plan \
  --manifest "$next_archive_root/release/manifests/<next-version>.json" \
  --artifact-root "$next_archive_root" \
  --root "$installation_root"
node "$next_archive_root/bin/vorton.cjs" upgrade apply \
  --plan sha256:<plan> \
  --root "$installation_root"
```

The updater opens a normal installation pull request. CI validates schemas, roles, policies, module compatibility, RLS, migrations, a fresh install, an upgrade from the deployed release, organization acceptance tests, worker protocols, and the candidate control plane.

Schema-v2 plans render `deploy/api.fly.toml`, `deploy/web.fly.toml`, `deploy/worker.fly.toml`, and `deploy/hindsight.fly.toml`. The API, web, and worker image fields come directly from the release manifest's immutable OCI references. Hindsight remains separately pinned to its reviewed upstream digest. The default templates contain no secrets and no Dockerfile build path. Operators provide secrets through Fly's secret store.

An organization may replace Hindsight's direct image field with a compatibility Dockerfile when a reviewed runtime adaptation is required. The updater then preserves the existing Hindsight Fly configuration byte for byte and continues updating only the three first-party Vorton image fields. Validation requires exactly one Hindsight build source. A Dockerfile path must be normalized, relative to the Fly configuration, contained within the installation, and based only on the reviewed digest-pinned Hindsight image. The organization owns the Dockerfile and any additional validation it requires.

On later upgrades, the CLI verifies the currently locked image and replaces only that field. It preserves app names, regions, environment configuration, scaling, checks, comments, and other organization-owned bytes. An unrecognized or manually changed image stops planning. Every image change remains visible in the content-addressed plan and the installation pull request. A release can require a separate organization configuration change, but that change remains a distinct reviewed installation pull request and never enters the Vorton image-update receipt.

The upgrade plan also owns two narrow installation fields. It changes only `spec.release.version` in `vorton.yaml`, leaving every other byte under organization ownership. It updates only recognized migration and image assertions in the generated Ruby validation contract. Both field classes appear explicitly in the reviewable plan. A validator with an unrecognized contract stops planning instead of being overwritten.

Merging the update pull request authorizes deployment in the first release. Opening the pull request does not. Deployment verifies the lock, checks backup readiness, serializes migrations, deploys exact image digests, verifies health, and records observed deployment identity in Postgres.

Database changes use expand and contract. Schema expansion precedes application rollout. Destructive cleanup occurs only in a later release after old workers are gone.

The target architecture separates Vorton core upgrades from module upgrades.
Core database changes require an all-workspace backup and staging rehearsal.
Module upgrades bind one exact module release, create a module-scoped backup,
apply backward-compatible schema expansion, activate the version per workspace,
and retain the prior artifact for rollback. A module update does not rebuild the
Vorton shell.

## Legacy rollback and target recovery

Configuration rollback reverts the installation commit. Application rollback redeploys the prior recorded image digest. Database recovery uses forward repair or explicit backup restoration. An image rollback never pretends to reverse organizational data.

Whole-installation point-in-time restoration rewinds every workspace and is
reserved for catastrophic recovery. Ordinary recovery restores a workspace or
module logical backup into an isolated namespace, verifies counts, hashes,
identity, and cross-workspace denial, and requires separate authority before
any production replacement.

Before an update is committed, a local receipt may restore only exact updater-owned files whose postimages are unchanged. Vorton never uses broad checkout or clean operations as rollback.

`node "$archive_root/bin/vorton.cjs" rollback --plan sha256:<plan> --root "$installation_root"` implements that local receipt rollback. It restores or removes updater-owned `host/**` and `vorton.lock.json` entries from the named journal. It restores only the prior desired-version field, Ruby validation assertions, and existing Fly image fields. Organization changes made after apply remain intact. It refuses rollback if an owned field changed again or if a newly created configuration changed after apply. Organization-owned scaffolding remains in place after an initial adoption rollback.

Organizations that modify Vorton core become distributors. They maintain a separate distribution fork, merge immutable upstream tags, build and attest their own images, and point installation locks to those images. Ordinary installations carry no patch queue.

## Release and deployment identity

`release/manifests/<version>.json` binds a release version to a source commit, CLI version, protocol contracts, migration head, managed templates, and digest-pinned OCI references. Candidate manifests contain no fictional image identities. A release uses a dedicated manifest commit because a file cannot contain the hash of its own commit. That commit may change only the release manifest. The release workflow refuses a tag until its manifest is explicitly marked `released`, its source commit equals the tagged manifest commit's only parent, every required first-party GHCR image resolves by digest, and every source-bound field matches the source tree. See [Immutable releases](RELEASES.md).

Fly configuration remains installation-owned. Vorton owns only the first-party image fields that bind those files to the release lock. A later deployment operation must consume the exact lock, verify backup readiness, serialize migrations, deploy digest-pinned images, verify health, and record observed identity in Postgres. Application rollback selects an earlier image digest. Database recovery remains a separate forward repair or explicitly authorized restoration.

## Legacy installation scaffold

The schema-v2 installation templates create four Fly service configurations for the API, web application, worker, and Hindsight. First-party images are exact release-manifest references. Hindsight uses its separate upstream digest and the deterministic worker ID `<installation-name>-memory`, which always satisfies its minimum length. Environment configuration names Supabase, Postgres, provider, and Hindsight settings without embedding secret values. Postgres remains authoritative for decisions, approvals, Policy, Work, receipts, and outcomes. Hindsight stores derived memory and grants no authority.

The Tools catalog starts empty. Moonbase Triage appears only as an uninstalled
synthetic example. The historical scaffold starts Factory in read-only mode and
describes execution as external. ADR 0007 supersedes that destination: the
current AubOS Factory becomes Vorton's Factory module, first visible read-only
in FreedOS and then enabled for governed execution. The legacy scaffold and
validator remain unchanged until a governed forward migration replaces them.

The scaffold also creates `tests/acceptance/validate-installation.rb` and a pinned GitHub Actions workflow. The validator uses only Ruby's standard library. It checks release identity, digest-pinned images, exact Fly image mappings, the absence of Dockerfile builds, managed-file hashes, memory authority, read-only Factory mode, and the blank installed Tools catalog without downloading an unpublished CLI or a moving package version.

The root operator can create the private repository, copy any organization-owned starter files, and then run the explicit init commands above with a real released manifest. The CLI preserves existing organization-owned files byte for byte and fills only missing scaffold paths.

## Reproducible fixture proof

The checked-in acceptance fixture uses synthetic manifests and `registry.invalid` image references. It proves the mechanics without claiming that an Vorton release or container image exists.

```bash
cd packages/cli
npm run proof:installation -- --output /tmp/vorton-installation-proof
```

The command creates `/tmp/vorton-installation-proof/moonbase-lab` and `/tmp/vorton-installation-proof/proof.json`. It adopts synthetic fixture release `0.1.0`, applies synthetic fixture release `0.1.1`, verifies the managed host change and desired release field, compares organization-owned content, and rolls back the exact Vorton-owned fields. It refuses to overwrite an existing output directory.

Run the acceptance suite from the CLI package:

```bash
npm test -- installation.acceptance.test.ts
```

The suite covers historical schema-v1 adoption and rollback, fresh schema-v2 service rendering, a FreedOS-shaped `0.1.1` to `0.2.0` upgrade, and an exact `0.2.1` to `0.3.0` upgrade with stable planning, preimage-conflict atomicity, idempotent apply, image-only deployment changes, organization-byte preservation, and exact rollback. It also covers desired-version and validator-contract migration, deterministic Hindsight identity, retry after an interrupted atomic write, rollback refusal after postimage drift, and scans for common personal-data and secret patterns.
