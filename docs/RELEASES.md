# Immutable releases

An AubOS release has three immutable identities:

1. The source commit contains runtime code, Dockerfiles, migrations, and managed templates.
2. GHCR stores the `control-plane`, `web`, and `worker` images built from that source. The image workflow records their registry digests and attaches BuildKit provenance and SBOM attestations to each image index.
3. A manifest-only child commit records the exact source parent, image references, current migration head, CLI version, protocol versions, and managed-template digests. The release tag points to this child commit.

Hindsight is an upstream installation dependency. AubOS does not build it or include it in the first-party image set.

## Build the images

The source commit must be on the repository's default branch and must contain:

```text
deploy/docker/control-plane.Dockerfile
apps/web/Dockerfile
deploy/docker/worker.Dockerfile
```

Dispatch the image workflow with a full commit hash and the intended SemVer:

```bash
source_commit=$(git rev-parse HEAD)
next_version=0.3.0
gh workflow run build-release-images.yml \
  -f source_commit="$source_commit" \
  -f version="$next_version"
```

The workflow builds all three images from the same checkout, publishes them to GHCR, adds the exact source commit as an OCI label, and attaches BuildKit provenance and SBOM metadata to each image index. It also exports one SPDX JSON SBOM per image. Every workflow action is pinned to an exact commit. Its `aubos-<version>-image-digests` artifact contains `image-digests.json`. That file is the handoff to manifest preparation. Do not invent, truncate, or retype digests.

GitHub's hosted artifact-attestation service requires GitHub Enterprise Cloud for private repositories. AubOS therefore uses registry-attached BuildKit attestations for its private MVP repository. The digest-pinned image, source label, exported SBOM, deterministic contract archive, and checksum are the release evidence. A later public repository or Enterprise installation may add GitHub or Sigstore signatures without changing the manifest contract.

Download the artifact outside the repository and inspect it:

```bash
run_id=<completed-image-workflow-run-id>
artifact_dir=$(mktemp -d)
gh run download "$run_id" \
  --name "aubos-$next_version-image-digests" \
  --dir "$artifact_dir"
jq . "$artifact_dir/image-digests.json"
```

## Prepare the manifest commit

Return to the exact clean source checkout. The preparation command refuses a source other than `HEAD`, a dirty worktree, mutable image tags, image repositories outside the selected GitHub owner's canonical `aubos-control-plane`, `aubos-web`, and `aubos-worker` packages, duplicate image names, missing templates, invalid protocol versions, and a CLI version that differs from `packages/cli/package.json`. It derives the current migration head and managed-file digests from the source commit's Git tree.

Manifest schema v1 is frozen for the historical 0.1.0 and 0.1.1 releases. Those manifests contain the control plane and worker images and remain replayable. The preparation command now emits schema v2. Every schema v2 released manifest contains exactly the control plane, web, and worker images.

Prepare the schema v2 release. Pass `--replace-candidate` only when replacing an existing candidate manifest for the same version:

```bash
source_commit=$(git rev-parse HEAD)
image_file="$artifact_dir/image-digests.json"
created_at=$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')
repository_owner=$(gh repo view --json owner --jq '.owner.login')
npm run release:prepare -- \
  --version "$next_version" \
  --created-at "$created_at" \
  --source-commit "$source_commit" \
  --host-contract 1 \
  --module-contract 1 \
  --worker-contract 1 \
  --repository-owner "$repository_owner" \
  --image-receipt "$image_file" \
  --managed-file "host/aubos-runtime.json=templates/releases/$next_version/host/aubos-runtime.json"
git add "release/manifests/$next_version.json"
git commit -m "chore: prepare AubOS $next_version release"
npm run release:preflight -- \
  --version "$next_version" \
  --repository-owner "$repository_owner" \
  --release-commit "$(git rev-parse HEAD)"
```

The timestamp is an explicit release input so repeated test fixtures are deterministic. Use the actual UTC release time. The preflight requires this commit to have exactly one parent equal to `sourceCommit` and to change only the selected manifest. It also verifies the repository owner, release commit, first-party image revision labels, registry provenance, registry SBOM evidence, and the pinned Hindsight image index for both `linux/amd64` and `linux/arm64`.

Serialize default-branch writes from the source image build through release landing. Open the manifest-only commit as a pull request. CI checks out the pull request head instead of GitHub's synthetic merge commit and runs the same preflight used by tag publication. Land it with squash, rebase, or fast-forward only when main still points to the image source commit, so main receives that one-parent manifest-only child. Wait for CI on that exact main commit, then tag that exact main commit. A normal merge commit fails preflight, and tagging the unmerged pull request head is forbidden. If main advances after the image source commit, abort the release attempt and rebuild the images and manifest from the new main tip. Do not rebase the prepared manifest child onto an advanced main tip because that breaks its exact source-parent binding.

After review, create and push the tag:

```bash
git tag -a "v$next_version" -m "AubOS v$next_version"
git push origin "v$next_version"
```

The tag workflow reruns the exact preflight. It creates a deterministic contract archive, checksum, and SPDX SBOM, then creates or recovers the GitHub Release from the tag. The archive contains the authoritative `supabase/migrations/*.sql` files from the tagged source alongside the release, schema, deployment, and template contracts. It also contains the first-install bootstrap, its default strategic-reviewer role skill, a dependency-locked bootstrap runtime, `bin/aubos.cjs`, and the self-contained `bin/hindsight-canary.cjs` release gate. Any mismatch stops publication.

The authenticated registry checks prove first-party image identity and evidence. They do not prove that Fly can pull a private GHCR package. Deployment remains blocked until the installation deliberately chooses one of two distribution contracts: public digest-pinned GHCR packages, or a verified promotion receipt that binds each source digest to a private `registry.fly.io` image. Release publication does not silently choose that policy.

An operator can bootstrap from only the extracted archive. No AubOS source checkout is required:

```bash
installation_directory=$(mktemp -d)
tar -xzf "aubos-$next_version-contracts.tgz" -C "$installation_directory"
cd "$installation_directory"
npm ci --ignore-scripts
AUBOS_BOOTSTRAP_AUTH_USER_ID=<supabase-auth-user-uuid> \
AUBOS_WORKER_PROVIDER=codex-subscription \
AUBOS_WORKER_MODEL=<explicit-codex-model> \
AUBOS_CODEX_MODEL=<same-explicit-codex-model> \
AUBOS_CODEX_REASONING_EFFORT=high \
npm run bootstrap:plan
```

The bundled CLI works before `npm ci` and needs no source checkout:

```bash
node "$installation_directory/bin/aubos.cjs" upgrade plan \
  --manifest "$installation_directory/release/manifests/$next_version.json" \
  --artifact-root "$installation_directory" \
  --root /absolute/path/to/private-installation
```

The bundled Hindsight gate also works before `npm ci`. From a trusted host with a private route to Hindsight, provide its private URL and tenant key through the environment and run:

```bash
node "$installation_directory/bin/hindsight-canary.cjs"
```

The CLI rejects any manifest whose `cliVersion` is not exactly the version embedded in the bundled executable. The locked npm install above is required only for the Postgres bootstrap commands.

After reviewing the plan and applying the archived migrations, use the same extracted installation directory and the `bootstrap:apply` environment described in `deploy/bootstrap/README.md`. The release tests extract a contract archive into an empty directory, run the bundled CLI before installing dependencies, prove version mismatch rejection, install only the locked bootstrap dependency set, and run the bootstrap plan against the archived role skill.

If publication infrastructure fails after the immutable tag is pushed, fix the workflow on the default branch and replay the existing tag. Never move or recreate the tag:

```bash
gh workflow run release.yml -f tag="v$next_version"
```

The replay checks out the existing tag, proves that `HEAD` resolves to that tag's commit, and runs the same release preflight before publishing. Publication starts with a draft and creates one only when the exact tag has no release. A replay adopts an exact-tag draft left by a failed upload, replaces only the three expected assets, downloads and byte-compares all three, verifies the archive checksum, and then publishes the draft. Before upload, the workflow proves that the raw SPDX 2.3 document has exactly one `DESCRIBES` target whose package name and SHA-256 match the contract archive. It then replaces Syft's time and random document namespace with values bound to the manifest creation time, release version, and contract artifact SHA-256. A zero fractional manifest time becomes the equivalent whole-second SPDX timestamp. Any nonzero fractional value fails because SPDX 2.3 cannot represent it exactly. The normalizer recursively sorts object keys and every SPDX 2.3 array field defined as a collection, including annotations, artifact origins, attribution texts, checksums, creators, cross references, described documents, external references, file contributors and dependencies, file types, files, extracted licenses, file and snippet license information, package file links, packages, excluded verification-code files, ranges, relationships, reviews, see-also references, and snippets. A replay of an already-published release performs the same exact verification and succeeds without uploading or changing any asset. Unexpected assets stop recovery and are never deleted automatically.

If `gh release create` reached GitHub but its response was lost, the current run may still fail. Replay the workflow. The next run finds and completes the exact-tag draft without moving the tag or creating a second release.

## Prepare the upgrade-proof release

The published `v0.2.1` release is the exact upgrade baseline for `v0.3.0`. First commit the managed host-contract change and its new versioned template. That commit becomes the new source commit. Build all three images again from that commit, download its digest artifact, and run the same command without `--replace-candidate`:

```bash
next_version=0.3.0
actual_host_contract_version=1
created_at=$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')
repository_owner=$(gh repo view --json owner --jq '.owner.login')
npm run release:prepare -- \
  --version "$next_version" \
  --created-at "$created_at" \
  --source-commit "$(git rev-parse HEAD)" \
  --host-contract "$actual_host_contract_version" \
  --module-contract 1 \
  --worker-contract 1 \
  --repository-owner "$repository_owner" \
  --image-receipt "$image_file" \
  --managed-file "host/aubos-runtime.json=templates/releases/$next_version/host/aubos-runtime.json"
```

Commit only the new release manifest, validate that commit, then create its immutable tag. The installation upgrade and rollback proof must consume the manifest's digest-pinned images. Tags are labels, never deployment identity.
