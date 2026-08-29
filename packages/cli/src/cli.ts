#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPlan,
  planInit,
  planUpgrade,
  rollbackPlan,
  validateInstallation,
} from "./index.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function required(args: string[], flag: string): string {
  const result = value(args, flag);
  if (!result) throw new Error(`Missing required option ${flag}`);
  return result;
}

function releasePath(version: string): string {
  return join(repositoryRoot, "release", "manifests", `${version}.json`);
}

function help(): never {
  process.stderr.write(
    "Usage:\n" +
      "  aubos init plan --organization NAME [--root PATH] [--version VERSION]\n" +
      "  aubos init apply --plan sha256:HASH [--root PATH]\n" +
      "  aubos upgrade plan --to VERSION [--root PATH]\n" +
      "  aubos upgrade apply --plan sha256:HASH [--root PATH]\n" +
      "  aubos rollback --plan sha256:HASH [--root PATH]\n" +
      "  aubos validate [--root PATH]\n",
  );
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  const [command, phase] = args;
  const root = resolve(value(args, "--root") ?? process.cwd());

  if (command === "init" && phase === "plan") {
    const version = value(args, "--version") ?? "0.1.0";
    const manifest = releasePath(version);
    if (!existsSync(manifest))
      throw new Error(`Unknown bundled release: ${version}`);
    const result = planInit({
      root,
      organization: required(args, "--organization"),
      releaseManifestPath: manifest,
      releaseRoot: repositoryRoot,
    });
    process.stdout.write(`${result.hash}\n${result.path}\n`);
    return;
  }

  if (command === "upgrade" && phase === "plan") {
    const version = required(args, "--to");
    const manifest = releasePath(version);
    if (!existsSync(manifest))
      throw new Error(`Unknown bundled release: ${version}`);
    const result = planUpgrade({
      root,
      releaseManifestPath: manifest,
      releaseRoot: repositoryRoot,
    });
    process.stdout.write(`${result.hash}\n${result.path}\n`);
    return;
  }

  if ((command === "init" || command === "upgrade") && phase === "apply") {
    const result = applyPlan({ root, planHash: required(args, "--plan") });
    process.stdout.write(`${result.status}\n${result.journalPath}\n`);
    return;
  }

  if (command === "rollback") {
    const result = rollbackPlan({ root, planHash: required(args, "--plan") });
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
