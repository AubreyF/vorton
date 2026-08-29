#!/usr/bin/env node

import { resolve } from "node:path";

import {
  applyPlan,
  planInit,
  planUpgrade,
  rollbackPlan,
  validateInstallation,
} from "./index.js";
import { CLI_VERSION } from "./version.js";

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
      "  aubos init plan --organization NAME --manifest PATH --artifact-root PATH [--root PATH]\n" +
      "  aubos init apply --plan sha256:HASH [--root PATH]\n" +
      "  aubos upgrade plan --manifest PATH --artifact-root PATH [--root PATH]\n" +
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
