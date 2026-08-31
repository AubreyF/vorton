#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { releaseManifestSchema } from "@vorton/contracts";
import {
  applyPlan,
  planInit,
  planUpgrade,
  rollbackPlan,
  validateInstallation,
} from "../packages/cli/src/index.js";
import { CLI_VERSION } from "../packages/cli/src/version.js";
import { validateWorkspaceReleaseEvidence } from "./workspace-release-evidence.js";
import { parseStrictJson } from "./strict-json.js";

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function required(args: string[], flag: string): string {
  const result = value(args, flag);
  if (!result) throw new Error(`Missing required option ${flag}`);
  return result;
}

function help(): never {
  process.stderr.write(
    "Usage:\n" +
      "  vorton init plan --organization NAME --manifest PATH --artifact-root PATH [--root PATH]\n" +
      "  vorton init apply --plan sha256:HASH [--root PATH]\n" +
      "  vorton upgrade plan --manifest PATH --artifact-root PATH [--root PATH]\n" +
      "  vorton upgrade apply --plan sha256:HASH [--root PATH]\n" +
      "  vorton rollback --plan sha256:HASH [--root PATH]\n" +
      "  vorton validate [--root PATH]\n",
  );
  process.exit(2);
}

function contained(root: string, path: string): boolean {
  const relation = relative(root, path);
  return (
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function readArtifactFile(artifactRoot: string, path: string): Buffer {
  if (isAbsolute(path) || path.split("/").some((segment) => segment === "..")) {
    throw new Error(`Workspace evidence path is unsafe: ${path}`);
  }
  const absoluteRoot = realpathSync(artifactRoot);
  const target = resolve(absoluteRoot, path);
  if (!contained(absoluteRoot, target)) {
    throw new Error(
      `Workspace evidence path escapes the artifact root: ${path}`,
    );
  }

  let cursor = absoluteRoot;
  for (const segment of path.split("/")) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) {
      throw new Error(`Workspace evidence file is missing: ${path}`);
    }
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error(
        `Workspace evidence path crosses a symbolic link: ${path}`,
      );
    }
  }
  const resolved = realpathSync(target);
  if (!contained(absoluteRoot, resolved) || !lstatSync(resolved).isFile()) {
    throw new Error(`Workspace evidence path is not a contained file: ${path}`);
  }
  return readFileSync(resolved);
}

export function validateArchivePlanEvidence(args: string[]): void {
  const [command, phase] = args;
  if (!(["init", "upgrade"].includes(command ?? "") && phase === "plan")) {
    return;
  }
  const manifestPath = resolve(required(args, "--manifest"));
  const artifactRoot = resolve(required(args, "--artifact-root"));
  const manifest = releaseManifestSchema.parse(
    parseStrictJson(readFileSync(manifestPath, "utf8"), "Release manifest"),
  );
  validateWorkspaceReleaseEvidence({
    manifest,
    read: (path) => readArtifactFile(artifactRoot, path),
  });
}

function main(): void {
  const args = process.argv.slice(2);
  validateArchivePlanEvidence(args);
  const [command, phase] = args;
  const root = resolve(value(args, "--root") ?? process.cwd());

  if (command === "init" && phase === "plan") {
    const result = planInit({
      root,
      organization: required(args, "--organization"),
      releaseManifestPath: resolve(required(args, "--manifest")),
      releaseRoot: resolve(required(args, "--artifact-root")),
      cliVersion: CLI_VERSION,
    });
    process.stdout.write(`${result.hash}\n${result.path}\n`);
    return;
  }

  if (command === "upgrade" && phase === "plan") {
    const result = planUpgrade({
      root,
      releaseManifestPath: resolve(required(args, "--manifest")),
      releaseRoot: resolve(required(args, "--artifact-root")),
      cliVersion: CLI_VERSION,
    });
    process.stdout.write(`${result.hash}\n${result.path}\n`);
    return;
  }

  if ((command === "init" || command === "upgrade") && phase === "apply") {
    const result = applyPlan({
      root,
      planHash: required(args, "--plan"),
      cliVersion: CLI_VERSION,
    });
    process.stdout.write(`${result.status}\n${result.journalPath}\n`);
    return;
  }

  if (command === "rollback") {
    const result = rollbackPlan({
      root,
      planHash: required(args, "--plan"),
      cliVersion: CLI_VERSION,
    });
    process.stdout.write(`${result.status}\n${result.restored.join("\n")}\n`);
    return;
  }

  if (command === "validate") {
    validateInstallation(root);
    process.stdout.write("valid\n");
    return;
  }

  help();
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
