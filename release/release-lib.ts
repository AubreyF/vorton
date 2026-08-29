import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";

import { releaseManifestSchema, type ReleaseManifest } from "@aubos/contracts";

const imageReferencePattern =
  /^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)+@sha256:[a-f0-9]{64}$/;

export function sha256(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function git(
  repositoryRoot: string,
  args: string[],
  encoding: "utf8" | "buffer" = "utf8",
): string | Buffer {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: encoding === "utf8" ? "utf8" : "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function resolveCommit(
  repositoryRoot: string,
  revision: string,
): string {
  return String(
    git(repositoryRoot, ["rev-parse", "--verify", `${revision}^{commit}`]),
  ).trim();
}

export function readGitFile(
  repositoryRoot: string,
  commit: string,
  path: string,
): Buffer {
  return git(repositoryRoot, ["show", `${commit}:${path}`], "buffer") as Buffer;
}

export function migrationHead(
  repositoryRoot: string,
  sourceCommit: string,
): string {
  const paths = String(
    git(repositoryRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      sourceCommit,
      "--",
      "supabase/migrations",
    ]),
  )
    .trim()
    .split("\n")
    .filter((path) => /^supabase\/migrations\/[^/]+\.sql$/.test(path))
    .sort();

  if (paths.length === 0) {
    throw new Error(`Source commit ${sourceCommit} has no core migrations`);
  }

  return basename(paths.at(-1)!, ".sql");
}

export function parseImageArgument(value: string): {
  name: string;
  reference: string;
  digest: string;
} {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    throw new Error(`Invalid --image value: ${value}`);
  }
  const name = value.slice(0, separator);
  const reference = value.slice(separator + 1);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`Invalid image name: ${name}`);
  }
  if (!imageReferencePattern.test(reference)) {
    throw new Error(
      `Image ${name} must be a lowercase GHCR reference pinned by sha256 digest`,
    );
  }
  const digest = reference.slice(reference.lastIndexOf("@") + 1);
  return { name, reference, digest };
}

export function parseImageReceipt(
  content: string,
  expectedSourceCommit: string,
  expectedVersion: string,
): Record<string, { reference: string; digest: string }> {
  const receipt = JSON.parse(content) as {
    sourceCommit?: unknown;
    version?: unknown;
    images?: unknown;
  };
  if (receipt.sourceCommit !== expectedSourceCommit) {
    throw new Error(
      `Image receipt source commit does not match release source`,
    );
  }
  if (receipt.version !== expectedVersion) {
    throw new Error(`Image receipt version does not match release version`);
  }
  if (
    !receipt.images ||
    typeof receipt.images !== "object" ||
    Array.isArray(receipt.images)
  ) {
    throw new Error(`Image receipt images must be an object`);
  }
  const imageEntries = Object.entries(receipt.images);
  const names = imageEntries.map(([name]) => name).sort();
  if (
    names.length !== 2 ||
    names[0] !== "control-plane" ||
    names[1] !== "worker"
  ) {
    throw new Error(
      `Image receipt must contain exactly control-plane and worker`,
    );
  }
  return Object.fromEntries(
    imageEntries.map(([name, reference]) => {
      if (typeof reference !== "string") {
        throw new Error(`Image receipt reference must be a string: ${name}`);
      }
      const image = parseImageArgument(`${name}=${reference}`);
      return [name, { reference: image.reference, digest: image.digest }];
    }),
  );
}

export function validateReleaseManifest(options: {
  repositoryRoot: string;
  manifestPath: string;
  expectedSourceCommit?: string;
  releaseCommit?: string;
}): ReleaseManifest {
  const manifestBytes = readFileSync(options.manifestPath);
  const manifest = releaseManifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const expectedFilename = `${manifest.version}.json`;
  if (basename(options.manifestPath) !== expectedFilename) {
    throw new Error(
      `Manifest filename mismatch: expected ${expectedFilename}, found ${basename(options.manifestPath)}`,
    );
  }

  const sourceCommit = resolveCommit(
    options.repositoryRoot,
    manifest.sourceCommit,
  );
  if (sourceCommit !== manifest.sourceCommit) {
    throw new Error(`Manifest sourceCommit is not a canonical commit hash`);
  }
  if (options.expectedSourceCommit) {
    const expected = resolveCommit(
      options.repositoryRoot,
      options.expectedSourceCommit,
    );
    if (expected !== sourceCommit) {
      throw new Error(
        `Release source commit mismatch: ${sourceCommit} != ${expected}`,
      );
    }
  }

  const cliPackage = JSON.parse(
    readGitFile(
      options.repositoryRoot,
      sourceCommit,
      "packages/cli/package.json",
    ).toString("utf8"),
  ) as { version?: unknown };
  if (cliPackage.version !== manifest.cliVersion) {
    throw new Error(
      `CLI version mismatch: manifest ${manifest.cliVersion}, source ${String(cliPackage.version)}`,
    );
  }

  const sourceMigrationHead = migrationHead(
    options.repositoryRoot,
    sourceCommit,
  );
  if (manifest.coreMigrationHead !== sourceMigrationHead) {
    throw new Error(
      `Core migration head mismatch: manifest ${manifest.coreMigrationHead}, source ${sourceMigrationHead}`,
    );
  }

  for (const [name, image] of Object.entries(manifest.images)) {
    const parsed = parseImageArgument(`${name}=${image.reference}`);
    if (parsed.digest !== image.digest) {
      throw new Error(`Image digest mismatch: ${name}`);
    }
  }

  for (const file of manifest.managedFiles) {
    const content = readGitFile(
      options.repositoryRoot,
      sourceCommit,
      file.template,
    );
    if (sha256(content) !== file.digest) {
      throw new Error(`Managed template digest mismatch: ${file.template}`);
    }
  }

  if (options.releaseCommit) {
    if (manifest.status !== "released") {
      throw new Error(`Release ${manifest.version} is still a candidate`);
    }
    const releaseCommit = resolveCommit(
      options.repositoryRoot,
      options.releaseCommit,
    );
    const parents = String(
      git(options.repositoryRoot, [
        "rev-list",
        "--parents",
        "-n",
        "1",
        releaseCommit,
      ]),
    )
      .trim()
      .split(/\s+/)
      .slice(1);
    if (parents.length !== 1 || parents[0] !== sourceCommit) {
      throw new Error(
        `Release commit must have exactly one parent equal to sourceCommit ${sourceCommit}`,
      );
    }

    const repositoryPath = relative(
      options.repositoryRoot,
      options.manifestPath,
    );
    const committedManifest = readGitFile(
      options.repositoryRoot,
      releaseCommit,
      repositoryPath,
    );
    if (!committedManifest.equals(manifestBytes)) {
      throw new Error(`Checked-out manifest differs from release commit`);
    }
    const changedPaths = String(
      git(options.repositoryRoot, [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        releaseCommit,
      ]),
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    if (changedPaths.length !== 1 || changedPaths[0] !== repositoryPath) {
      throw new Error(
        `Release commit may change only ${repositoryPath}; found ${changedPaths.join(", ")}`,
      );
    }
  }

  return manifest;
}
