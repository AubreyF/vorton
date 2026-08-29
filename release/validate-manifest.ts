import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateReleaseManifest } from "./release-lib.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const version = option("--version");
const repositoryOwner = option("--repository-owner");
if (args.includes("--released") && !repositoryOwner) {
  throw new Error(`--repository-owner is required with --released`);
}
const manifestsDirectory = join(repositoryRoot, "release", "manifests");
const paths = version
  ? [join(manifestsDirectory, `${version}.json`)]
  : readdirSync(manifestsDirectory)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(manifestsDirectory, name));

if (paths.length === 0) throw new Error(`No release manifests found`);
for (const path of paths) {
  if (!existsSync(path)) throw new Error(`Release manifest not found: ${path}`);
  const manifest = validateReleaseManifest({
    repositoryRoot,
    manifestPath: path,
    expectedSourceCommit: option("--source-commit"),
    expectedRepositoryOwner: repositoryOwner,
    releaseCommit: option("--release-commit"),
  });
  if (args.includes("--released") && manifest.status !== "released") {
    throw new Error(`Release ${manifest.version} is still a candidate`);
  }
  process.stdout.write(`valid ${manifest.version} ${manifest.status}\n`);
}
