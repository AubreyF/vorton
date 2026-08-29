import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const protectedPaths = [
  "organization/identity.yaml",
  "organization/modules.yaml",
  "organization/policies/authority.yaml",
  "organization/roles/owner.yaml",
  "deploy/fly.toml",
  "tools/README.md",
  "tests/acceptance/organization.test.md",
] as const;
const protectedDigests = (): Record<string, string> =>
  Object.fromEntries(
    protectedPaths.map((path) => [
      path,
      sha256(readFileSync(join(installationRoot, path))),
    ]),
  );

mkdirSync(outputRoot, { recursive: false });
cpSync(fixtureRoot, installationRoot, { recursive: true });
const organizationBefore = protectedDigests();

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
