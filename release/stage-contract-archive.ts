import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { releaseManifestSchema } from "@vorton/contracts";

import { validateWorkspaceReleaseEvidence } from "./workspace-release-evidence.js";
import { parseStrictJson } from "./strict-json.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const archiveDirectories = [
  "deploy",
  "release/bootstrap-runtime",
  "release/manifests",
  "schemas",
  "supabase/migrations",
  "templates",
  "packages/executive/roles",
] as const;

function requireSafeDestination(destination: string): {
  absolute: string;
  expectedReal: string;
} {
  const requested = resolve(destination);
  const temporaryRoot = resolve(tmpdir());
  const absolute = contained(temporaryRoot, requested)
    ? join(realpathSync(temporaryRoot), relative(temporaryRoot, requested))
    : requested;
  const root = sep;
  const components = relative(root, absolute).split(sep).filter(Boolean);
  let cursor = root;
  for (const component of components) {
    cursor = join(cursor, component);
    if (!existsSync(cursor)) break;
    const status = lstatSync(cursor);
    if (status.isSymbolicLink()) {
      throw new Error("Archive destination ancestor cannot be a symbolic link");
    }
    if (!status.isDirectory()) {
      throw new Error("Archive destination ancestor must be a real directory");
    }
  }
  return { absolute, expectedReal: absolute };
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return (
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function requireSafeSourcePath(sourceRoot: string, relativePath: string): void {
  const absoluteRoot = realpathSync(sourceRoot);
  const target = resolve(absoluteRoot, relativePath);
  if (!contained(absoluteRoot, target) || !existsSync(target)) {
    throw new Error(
      `Archive source path is missing or escapes its root: ${relativePath}`,
    );
  }

  const visit = (path: string): void => {
    const status = lstatSync(path);
    if (status.isSymbolicLink()) {
      throw new Error(
        `Archive source contains a symbolic link: ${relative(absoluteRoot, path)}`,
      );
    }
    const resolved = realpathSync(path);
    if (!contained(absoluteRoot, resolved)) {
      throw new Error(
        `Archive source path escapes its root: ${relative(absoluteRoot, path)}`,
      );
    }
    if (status.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
      return;
    }
    if (!status.isFile()) {
      throw new Error(
        `Archive source contains a non-file entry: ${relative(absoluteRoot, path)}`,
      );
    }
  };
  visit(target);
}

export async function stageContractArchive(
  destination: string,
  sourceRoot = repositoryRoot,
  releaseVersion?: string,
): Promise<void> {
  if (lstatSync(sourceRoot).isSymbolicLink()) {
    throw new Error("Archive source root cannot be a symbolic link");
  }
  const absoluteSourceRoot = realpathSync(sourceRoot);
  const safeDestination = requireSafeDestination(destination);
  const absoluteDestination = safeDestination.absolute;
  if (contained(absoluteSourceRoot, absoluteDestination)) {
    throw new Error("Archive destination cannot be inside its source root");
  }
  if (
    existsSync(absoluteDestination) &&
    lstatSync(absoluteDestination).isSymbolicLink()
  ) {
    throw new Error("Archive destination cannot be a symbolic link");
  }
  const archiveCliSource = existsSync(
    join(sourceRoot, "release/archive-cli.ts"),
  )
    ? "release/archive-cli.ts"
    : "packages/cli/src/cli.ts";
  for (const path of [
    ...archiveDirectories,
    "packages/cli/package.json",
    archiveCliSource,
    "release/bootstrap-runtime/package.json",
    "release/bootstrap-runtime/package-lock.json",
    "release/hindsight-canary-cli.ts",
  ]) {
    requireSafeSourcePath(sourceRoot, path);
  }
  if (existsSync(join(sourceRoot, "release/evidence"))) {
    requireSafeSourcePath(sourceRoot, "release/evidence");
  }

  await mkdir(absoluteDestination, { recursive: true });
  const destinationReal = realpathSync(absoluteDestination);
  if (destinationReal !== safeDestination.expectedReal) {
    throw new Error("Archive destination resolves through a symbolic link");
  }
  const optionalDirectories = existsSync(join(sourceRoot, "release/evidence"))
    ? (["release/evidence"] as const)
    : [];
  for (const directory of [...archiveDirectories, ...optionalDirectories]) {
    await cp(join(sourceRoot, directory), join(destination, directory), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }

  const runtimePackageRoot = join(sourceRoot, "release/bootstrap-runtime");
  const cliPackage = JSON.parse(
    await readFile(join(sourceRoot, "packages/cli/package.json"), "utf8"),
  ) as { version?: unknown };
  const runtimePackage = JSON.parse(
    await readFile(join(runtimePackageRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  const runtimeLock = JSON.parse(
    await readFile(join(runtimePackageRoot, "package-lock.json"), "utf8"),
  ) as { version?: unknown; packages?: { ""?: { version?: unknown } } };
  if (
    typeof cliPackage.version !== "string" ||
    runtimePackage.version !== cliPackage.version ||
    runtimeLock.version !== cliPackage.version ||
    runtimeLock.packages?.[""]?.version !== cliPackage.version
  ) {
    throw new Error(
      `Archive runtime and lock must match Vorton CLI ${String(cliPackage.version)}`,
    );
  }
  for (const filename of ["package.json", "package-lock.json"] as const) {
    await writeFile(
      join(destination, filename),
      await readFile(join(runtimePackageRoot, filename)),
      { flag: "wx" },
    );
  }

  const cliOutput = join(destination, "bin/vorton.cjs");
  await mkdir(dirname(cliOutput), { recursive: true });
  await build({
    entryPoints: [join(sourceRoot, archiveCliSource)],
    outfile: cliOutput,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    legalComments: "none",
    sourcemap: false,
    packages: "bundle",
  });
  await chmod(cliOutput, 0o755);

  const canaryOutput = join(destination, "bin/hindsight-canary.cjs");
  await build({
    entryPoints: [join(sourceRoot, "release/hindsight-canary-cli.ts")],
    outfile: canaryOutput,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    legalComments: "none",
    sourcemap: false,
    packages: "bundle",
  });
  await chmod(canaryOutput, 0o755);

  if (releaseVersion) {
    await verifyStagedWorkspaceEvidence(
      sourceRoot,
      destination,
      releaseVersion,
    );
  }
}

export async function verifyStagedWorkspaceEvidence(
  sourceRoot: string,
  destination: string,
  releaseVersion: string,
): Promise<void> {
  const manifestPath = `release/manifests/${releaseVersion}.json`;
  const manifest = releaseManifestSchema.parse(
    parseStrictJson(
      await readFile(join(sourceRoot, manifestPath), "utf8"),
      "Release manifest",
    ),
  );
  const sourcePaths = validateWorkspaceReleaseEvidence({
    manifest,
    // The archive carries exact evidence bytes, not a normalized JSON copy.
    read: (path) => readFileSync(join(sourceRoot, path)),
  });
  const stagedPaths = validateWorkspaceReleaseEvidence({
    manifest,
    read: (path) => readFileSync(join(destination, path)),
  });
  if (sourcePaths.join("\n") !== stagedPaths.join("\n")) {
    throw new Error("Staged workspace evidence path set differs");
  }
  for (const path of sourcePaths) {
    const source = await readFile(join(sourceRoot, path));
    const staged = await readFile(join(destination, path));
    if (!source.equals(staged)) {
      throw new Error(`Staged workspace evidence bytes differ: ${path}`);
    }
  }
}

async function main(): Promise<void> {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) {
    throw new Error("Usage: stage-contract-archive <empty-destination>");
  }
  await stageContractArchive(
    resolve(destination),
    repositoryRoot,
    process.env.VERSION,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Archive staging failed",
    );
    process.exitCode = 1;
  });
}
