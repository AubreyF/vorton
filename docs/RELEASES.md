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
next_version=0.2.0
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
npm run release:validate -- \
  --version "$next_version" \
  --released \
  --repository-owner "$repository_owner" \
  --release-commit "$(git rev-parse HEAD)"
```

The timestamp is an explicit release input so repeated test fixtures are deterministic. Use the actual UTC release time. The validator requires this commit to have exactly one parent equal to `sourceCommit` and to change only the selected manifest.

After review, create and push the tag:

```bash
git tag -a "v$next_version" -m "AubOS v$next_version"
git push origin "v$next_version"
```

The tag workflow revalidates the source parent, migration head, CLI version, managed templates, and manifest-only diff. It asks GHCR to resolve every digest-pinned image, checks the embedded source-commit label, and requires attached BuildKit provenance and SBOM data. It creates a deterministic contract archive, checksum, and SPDX SBOM, then creates the GitHub Release from the tag. The archive contains the authoritative `supabase/migrations/*.sql` files from the tagged source alongside the release, schema, deployment, and template contracts. It also contains the first-install bootstrap, its default strategic-reviewer role skill, a dependency-locked bootstrap runtime, and `bin/aubos.cjs`, the standalone CLI bundled from that tag. Any mismatch stops publication.

An operator can bootstrap from only the extracted archive. No AubOS source checkout is required:

```bash
installation_directory=$(mktemp -d)
tar -xzf "aubos-$next_version-contracts.tgz" -C "$installation_directory"
cd "$installation_directory"
npm ci --ignore-scripts
AUBOS_BOOTSTRAP_AUTH_USER_ID=<supabase-auth-user-uuid> \
AUBOS_WORKER_PROVIDER=openai-responses \
AUBOS_WORKER_MODEL=<explicit-model> \
AUBOS_OPENAI_MODEL=<same-explicit-model> \
npm run bootstrap:plan
```

The bundled CLI works before `npm ci` and needs no source checkout:

```bash
node "$installation_directory/bin/aubos.cjs" upgrade plan \
  --manifest "$installation_directory/release/manifests/$next_version.json" \
  --artifact-root "$installation_directory" \
  --root /absolute/path/to/private-installation
```

The CLI rejects any manifest whose `cliVersion` is not exactly the version embedded in the bundled executable. The locked npm install above is required only for the Postgres bootstrap commands.

After reviewing the plan and applying the archived migrations, use the same extracted installation directory and the `bootstrap:apply` environment described in `deploy/bootstrap/README.md`. The release tests extract a contract archive into an empty directory, run the bundled CLI before installing dependencies, prove version mismatch rejection, install only the locked bootstrap dependency set, and run the bootstrap plan against the archived role skill.

If publication infrastructure fails after the immutable tag is pushed, fix the workflow on the default branch and replay the existing tag. Never move or recreate the tag:

```bash
gh workflow run release.yml -f tag=v0.1.0
```

The replay checks out the existing tag, proves that `HEAD` resolves to that tag's commit, and runs the same release validation before publishing. The workflow implementation may improve after the tag. The released source, manifest, images, and archive inputs remain bound to the original tag.

## Prepare the upgrade-proof release

The published `v0.1.1` release remains a schema v1 compatibility fixture. For the next release, first commit the real managed host-contract change and its new versioned template. That commit becomes the new source commit. Build all three images again from that commit, download its digest artifact, and run the same command without `--replace-candidate`:

```bash
next_version=0.2.0
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
