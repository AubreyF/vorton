import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releaseManifestSchema } from "@aubos/contracts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

const version = option("--version");
const paths = version
  ? [join(repositoryRoot, "release", "manifests", `${version}.json`)]
  : ["0.1.0", "0.2.0"].map((item) =>
      join(repositoryRoot, "release", "manifests", `${item}.json`),
    );

for (const path of paths) {
  if (!existsSync(path)) throw new Error(`Release manifest not found: ${path}`);
  const manifest = releaseManifestSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  for (const file of manifest.managedFiles) {
    const content = readFileSync(join(repositoryRoot, file.template), "utf8");
    if (digest(content) !== file.digest) {
      throw new Error(`Managed template digest mismatch: ${file.template}`);
    }
  }
  if (args.includes("--released") && manifest.status !== "released") {
    throw new Error(`Release ${manifest.version} is still a candidate`);
  }
  const sourceCommit = option("--source-commit");
  if (sourceCommit && manifest.sourceCommit !== sourceCommit) {
    throw new Error(
      `Release source commit mismatch: ${manifest.sourceCommit} != ${sourceCommit}`,
    );
  }
  process.stdout.write(`valid ${manifest.version} ${manifest.status}\n`);
}
