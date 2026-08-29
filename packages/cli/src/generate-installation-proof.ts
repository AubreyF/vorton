import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPlan,
  canonicalJson,
  planInit,
  planUpgrade,
  rollbackPlan,
  sha256,
  validateInstallation,
} from "./index.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const outputIndex = process.argv.indexOf("--output");
const outputArgument =
  outputIndex === -1 ? undefined : process.argv[outputIndex + 1];

if (!outputArgument) {
  throw new Error("Usage: npm run proof:installation -- --output PATH");
}

const outputRoot = resolve(outputArgument);
if (existsSync(outputRoot)) {
  throw new Error(`Proof output already exists: ${outputRoot}`);
}

const installationRoot = join(outputRoot, "freedos");
const fixtureRoot = join(
  repositoryRoot,
  "packages/cli/test-fixtures/freedos-private",
);
const releaseManifest = (version: string): string =>
  join(
    repositoryRoot,
    "packages/cli/test-fixtures/releases",
    `${version}.json`,
  );
const filesUnder = (root: string): string[] => {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(root);
  return files.sort();
};
const protectedDigests = (): Record<string, string> =>
  (() => {
    const lock = JSON.parse(
      readFileSync(join(installationRoot, "aubos.lock.json"), "utf8"),
    ) as { managedFiles: Record<string, string> };
    const managed = new Set(Object.keys(lock.managedFiles));
    return Object.fromEntries(
      filesUnder(installationRoot)
        .map((path) => relative(installationRoot, path))
        .filter(
          (path) =>
            path !== "aubos.lock.json" &&
            !path.startsWith(".aubos/") &&
            !managed.has(path),
        )
        .map((path) => [
          path,
          sha256(readFileSync(join(installationRoot, path))),
        ]),
    );
  })();

mkdirSync(outputRoot, { recursive: false });
cpSync(fixtureRoot, installationRoot, { recursive: true });
const adoption = planInit({
  root: installationRoot,
  organization: "FreedOS",
  releaseManifestPath: releaseManifest("0.1.0"),
  releaseRoot: repositoryRoot,
  allowCandidate: true,
});
const adoptionResult = applyPlan({
  root: installationRoot,
  planHash: adoption.hash,
});
validateInstallation(installationRoot);
const organizationBefore = protectedDigests();

const upgrade = planUpgrade({
  root: installationRoot,
  releaseManifestPath: releaseManifest("0.1.1"),
  releaseRoot: repositoryRoot,
  allowCandidate: true,
});
const upgradeResult = applyPlan({
  root: installationRoot,
  planHash: upgrade.hash,
});
const upgradedHostDigest = sha256(
  readFileSync(join(installationRoot, "host/aubos-runtime.json")),
);
const organizationAfterUpgrade = protectedDigests();
const rollbackResult = rollbackPlan({
  root: installationRoot,
  planHash: upgrade.hash,
});
validateInstallation(installationRoot);
const organizationAfterRollback = protectedDigests();

if (
  canonicalJson(organizationBefore) !==
    canonicalJson(organizationAfterUpgrade) ||
  canonicalJson(organizationBefore) !== canonicalJson(organizationAfterRollback)
) {
  throw new Error("An organization-owned proof file changed");
}

const reportPath = join(outputRoot, "proof.json");
writeFileSync(
  reportPath,
  canonicalJson({
    schemaVersion: 1,
    fixtureOnly: true,
    deploymentAuthorized: false,
    installationRoot: "freedos",
    manifests: {
      adoption: {
        fixture: "0.1.0",
        digest: sha256(readFileSync(releaseManifest("0.1.0"))),
      },
      upgrade: {
        fixture: "0.1.1",
        digest: sha256(readFileSync(releaseManifest("0.1.1"))),
      },
    },
    adoption: {
      planHash: adoption.hash,
      status: adoptionResult.status,
    },
    upgrade: {
      planHash: upgrade.hash,
      status: upgradeResult.status,
      managedHostDigest: upgradedHostDigest,
    },
    rollback: rollbackResult,
    organizationOwnedDigests: organizationBefore,
  }),
);

process.stdout.write(`${reportPath}\n${installationRoot}\n`);
