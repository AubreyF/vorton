# Immutable releases

An AubOS release has three immutable identities:

1. The source commit contains runtime code, Dockerfiles, migrations, and managed templates.
2. GHCR stores the `control-plane` and `worker` images built from that source. The image workflow records their registry digests and generates provenance and SBOM attestations.
3. A manifest-only child commit records the exact source parent, image references, current migration head, CLI version, protocol versions, and managed-template digests. The release tag points to this child commit.

Hindsight is an upstream installation dependency. AubOS does not build it or include it in the first-party image set.

## Build the images

The source commit must be on the repository's default branch and must contain:

```text
deploy/docker/control-plane.Dockerfile
deploy/docker/worker.Dockerfile
```

Dispatch the image workflow with a full commit hash and the intended SemVer:

```bash
source_commit=$(git rev-parse HEAD)
gh workflow run build-release-images.yml \
  -f source_commit="$source_commit" \
  -f version=0.1.0
```

The workflow builds both images from the same checkout, publishes them to GHCR, generates SPDX JSON SBOMs, and creates GitHub provenance and SBOM attestations. Every workflow action is pinned to an exact commit. Its `aubos-<version>-image-digests` artifact contains `image-digests.json`. That file is the handoff to manifest preparation. Do not invent, truncate, or retype digests.

Download the artifact outside the repository and inspect it:

```bash
run_id=<completed-image-workflow-run-id>
artifact_dir=$(mktemp -d)
gh run download "$run_id" \
  --name aubos-0.1.0-image-digests \
  --dir "$artifact_dir"
jq . "$artifact_dir/image-digests.json"
```

## Prepare the manifest commit

Return to the exact clean source checkout. The preparation command refuses a source other than `HEAD`, a dirty worktree, mutable image tags, non-GHCR image references, duplicate image names, missing templates, invalid protocol versions, and a CLI version that differs from `packages/cli/package.json`. It derives the current migration head and managed-file digests from the source commit's Git tree.

Prepare the first release by replacing the old candidate:

```bash
source_commit=$(git rev-parse HEAD)
image_file="$artifact_dir/image-digests.json"
created_at=$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')
npm run release:prepare -- \
  --version 0.1.0 \
  --created-at "$created_at" \
  --source-commit "$source_commit" \
  --host-contract 1 \
  --module-contract 1 \
  --worker-contract 1 \
  --image-receipt "$image_file" \
  --managed-file host/aubos-runtime.json=templates/releases/0.1.0/host/aubos-runtime.json \
  --replace-candidate
git add release/manifests/0.1.0.json
git commit -m "chore: prepare AubOS 0.1.0 release"
npm run release:validate -- \
  --version 0.1.0 \
  --released \
  --release-commit "$(git rev-parse HEAD)"
```

The timestamp is an explicit release input so repeated test fixtures are deterministic. Use the actual UTC release time. The validator requires this commit to have exactly one parent equal to `sourceCommit` and to change only the selected manifest.

After review, create and push the tag:

```bash
git tag -a v0.1.0 -m "AubOS v0.1.0"
git push origin v0.1.0
```

The tag workflow revalidates the source parent, migration head, CLI version, managed templates, and manifest-only diff. It asks GHCR to resolve every digest-pinned image, then verifies provenance and SPDX attestations from the designated image-build workflow against the manifest's exact source commit. It creates a deterministic contract archive, generates its SBOM, creates GitHub attestations, and creates the GitHub Release from the tag. Any mismatch stops publication.

## Prepare the upgrade-proof release

For `v0.1.1`, first commit the real managed host-contract change and its new template under `templates/releases/0.1.1/`. That commit becomes the new source commit. Build both images again from that commit, download its digest artifact, and run the same command without `--replace-candidate`:

```bash
created_at=$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')
npm run release:prepare -- \
  --version 0.1.1 \
  --created-at "$created_at" \
  --source-commit "$(git rev-parse HEAD)" \
  --host-contract <actual-host-contract-version> \
  --module-contract 1 \
  --worker-contract 1 \
  --image-receipt "$image_file" \
  --managed-file host/aubos-runtime.json=templates/releases/0.1.1/host/aubos-runtime.json
```

Commit only `release/manifests/0.1.1.json`, validate that commit, then create `v0.1.1`. The installation upgrade and rollback proof must consume the manifest's digest-pinned images. Tags are labels, never deployment identity.
