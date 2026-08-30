import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releaseManifestSchema, type ReleaseManifest } from "@vorton/contracts";

import {
  git,
  migrationHead,
  parseImageReceipt,
  readGitFile,
  resolveCommit,
  sha256,
  validateReleaseManifest,
} from "./release-lib.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueOptions = new Set([
  "--version",
  "--created-at",
  "--source-commit",
  "--cli-version",
  "--host-contract",
  "--module-contract",
  "--worker-contract",
  "--image-receipt",
  "--repository-owner",
  "--managed-file",
]);
for (let index = 0; index < args.length; index += 2) {
  const name = args[index]!;
  if (name === "--replace-candidate") {
    index -= 1;
    continue;
  }
  if (!valueOptions.has(name)) throw new Error(`Unknown option ${name}`);
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
}

function values(name: string): string[] {
  return args.flatMap((value, index) =>
    value === name && args[index + 1] ? [args[index + 1]!] : [],
  );
}

function required(name: string): string {
  const found = values(name);
  if (found.length === 0) throw new Error(`Missing required option ${name}`);
  if (found.length > 1) throw new Error(`Option may appear only once: ${name}`);
  return found[0]!;
}

function positiveInteger(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function managedFile(value: string): { path: string; template: string } {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Invalid --managed-file value: ${value}`);
  }
  return {
    path: value.slice(0, separator),
    template: value.slice(separator + 1),
  };
}

const version = required("--version");
if (
  !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
    version,
  )
) {
  throw new Error(`Version must be SemVer: ${version}`);
}
const createdAt = required("--created-at");
if (Number.isNaN(Date.parse(createdAt)) || !createdAt.endsWith("Z")) {
  throw new Error(`--created-at must be an ISO 8601 UTC timestamp`);
}
const sourceCommit = resolveCommit(repositoryRoot, required("--source-commit"));
const head = resolveCommit(repositoryRoot, "HEAD");
if (sourceCommit !== head) {
  throw new Error(`--source-commit must equal HEAD ${head}`);
}
if (String(git(repositoryRoot, ["status", "--porcelain"])).trim()) {
  throw new Error(`Release preparation requires a clean source worktree`);
}

const cliVersion = (
  JSON.parse(
    readGitFile(
      repositoryRoot,
      sourceCommit,
      "packages/cli/package.json",
    ).toString("utf8"),
  ) as { version: string }
).version;
const explicitCliVersion = values("--cli-version").at(-1);
if (values("--cli-version").length > 1) {
  throw new Error(`Option may appear only once: --cli-version`);
}
if (explicitCliVersion && explicitCliVersion !== cliVersion) {
  throw new Error(
    `--cli-version ${explicitCliVersion} does not match source ${cliVersion}`,
  );
}

const imageReceiptPath = resolve(required("--image-receipt"));
const images = parseImageReceipt(
  readFileSync(imageReceiptPath, "utf8"),
  sourceCommit,
  version,
  required("--repository-owner"),
);

const managedFiles = values("--managed-file").map((value) => {
  const file = managedFile(value);
  return {
    ...file,
    digest: sha256(readGitFile(repositoryRoot, sourceCommit, file.template)),
  };
});
if (managedFiles.length === 0) {
  throw new Error(`At least one --managed-file is required`);
}
if (
  new Set(managedFiles.map((file) => file.path)).size !== managedFiles.length
) {
  throw new Error(`Managed file paths must be unique`);
}

const manifest: ReleaseManifest = releaseManifestSchema.parse({
  schemaVersion: 2,
  status: "released",
  version,
  sourceCommit,
  createdAt,
  cliVersion,
  contracts: {
    host: positiveInteger("--host-contract"),
    module: positiveInteger("--module-contract"),
    worker: positiveInteger("--worker-contract"),
  },
  coreMigrationHead: migrationHead(repositoryRoot, sourceCommit),
  images,
  managedFiles,
});

const output = join(repositoryRoot, "release", "manifests", `${version}.json`);
if (existsSync(output)) {
  if (!args.includes("--replace-candidate")) {
    throw new Error(`Manifest already exists: ${output}`);
  }
  const existing = JSON.parse(readFileSync(output, "utf8")) as {
    status?: unknown;
    version?: unknown;
  };
  if (existing.status !== "candidate" || existing.version !== version) {
    throw new Error(
      `--replace-candidate can replace only the same candidate version`,
    );
  }
}

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: existsSync(output) ? "w" : "wx",
});
validateReleaseManifest({
  repositoryRoot,
  manifestPath: output,
  expectedRepositoryOwner: required("--repository-owner"),
});
process.stdout.write(`${output}\n`);
