import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const archiveDirectories = [
  "deploy",
  "release",
  "schemas",
  "supabase/migrations",
  "templates",
  "packages/executive/roles",
] as const;

export async function stageContractArchive(
  destination: string,
  sourceRoot = repositoryRoot,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const directory of archiveDirectories) {
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
    entryPoints: [join(sourceRoot, "packages/cli/src/cli.ts")],
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
}

async function main(): Promise<void> {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) {
    throw new Error("Usage: stage-contract-archive <empty-destination>");
  }
  await stageContractArchive(resolve(destination));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Archive staging failed",
    );
    process.exitCode = 1;
  });
}
