import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

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
const fixtureRoot = join(
  repositoryRoot,
  "packages/cli/test-fixtures/synthetic-organization",
);
const generatedRoots: string[] = [];

function manifest(version: "0.1.0" | "0.1.1" | "0.2.0" | "0.3.0"): string {
  return join(
    repositoryRoot,
    "packages/cli/test-fixtures/releases",
    `${version}.json`,
  );
}

function releasedManifest(version: "0.2.1" | "0.3.0" | "0.3.1"): string {
  return join(repositoryRoot, "release/manifests", `${version}.json`);
}

const hindsightImage =
  "ghcr.io/vectorize-io/hindsight@sha256:a0e937366261b8a8f20ebcaf13758c689c381dcbbf01684e4375c2787c8c666d";
const previousHindsightImage =
  "ghcr.io/vectorize-io/hindsight@sha256:ac50c0d95a65c88545f46665dc432544bcc378cec89e03675786a1d9383feb2d";
const v021ValidatorFixture = join(
  repositoryRoot,
  "packages/cli/test-fixtures/validators/v0.2.1.validate-installation.rb",
);
const validatorPaths = [
  "scripts/validate-installation.rb",
  "tests/acceptance/validate-installation.rb",
] as const;

const v2Images = {
  "deploy/api.fly.toml":
    "registry.invalid/vorton-fixture/control-plane@sha256:3333333333333333333333333333333333333333333333333333333333333333",
  "deploy/web.fly.toml":
    "registry.invalid/vorton-fixture/web@sha256:4444444444444444444444444444444444444444444444444444444444444444",
  "deploy/worker.fly.toml":
    "registry.invalid/vorton-fixture/worker@sha256:5555555555555555555555555555555555555555555555555555555555555555",
  "deploy/hindsight.fly.toml": hindsightImage,
} as const;

const v3Images = {
  "deploy/api.fly.toml":
    "registry.invalid/vorton-fixture/control-plane@sha256:6666666666666666666666666666666666666666666666666666666666666666",
  "deploy/web.fly.toml":
    "registry.invalid/vorton-fixture/web@sha256:7777777777777777777777777777777777777777777777777777777777777777",
  "deploy/worker.fly.toml":
    "registry.invalid/vorton-fixture/worker@sha256:8888888888888888888888888888888888888888888888888888888888888888",
  "deploy/hindsight.fly.toml": hindsightImage,
} as const;

function buildImage(content: string): string {
  const match = /\[build]\s+image\s*=\s*"([^"]+)"/m.exec(content);
  if (!match) throw new Error("Missing fixture build image");
  return match[1]!;
}

function syntheticInstallationRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "vorton-synthetic-proof-"));
  generatedRoots.push(root);
  cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

function blankInstallationRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "vorton-blank-proof-"));
  generatedRoots.push(root);
  return root;
}

function filesUnder(root: string): string[] {
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
}

function snapshotExistingFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    filesUnder(root).map((path) => [
      relative(root, path),
      readFileSync(path, "utf8"),
    ]),
  );
}

function snapshotOrganizationOwned(root: string): Record<string, string> {
  const lock = JSON.parse(
    readFileSync(join(root, "vorton.lock.json"), "utf8"),
  ) as { managedFiles: Record<string, string> };
  const managed = new Set(Object.keys(lock.managedFiles));
  return Object.fromEntries(
    filesUnder(root)
      .map((path) => relative(root, path))
      .filter(
        (path) =>
          path !== "vorton.lock.json" &&
          !path.startsWith(".vorton/") &&
          !managed.has(path),
      )
      .map((path) => [path, readFileSync(join(root, path), "utf8")] as const)
      .map(([path, content]) => [
        path,
        path === "vorton.yaml"
          ? content.replace(/^(\s*version:\s*)[^\n#]+/m, "$1{{VORTON_VERSION}}")
          : content,
      ]),
  );
}

afterEach(() => {
  for (const root of generatedRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("synthetic organization installation acceptance", () => {
  it("renders a fresh schema-v2 installation with four immutable service images", () => {
    const root = blankInstallationRoot();
    const planned = planInit({
      root,
      organization: "Freed",
      releaseManifestPath: manifest("0.2.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: planned.hash });
    validateInstallation(root);

    for (const [path, expectedImage] of Object.entries(v2Images)) {
      const content = readFileSync(join(root, path), "utf8");
      expect(buildImage(content)).toBe(expectedImage);
      expect(content).not.toMatch(/^\s*dockerfile\s*=/m);
      expect(content).not.toContain("REPLACE_WITH_LOCKED_OCI_REFERENCE");
      expect(content).not.toMatch(/:(?:latest|main|stable)(?:\s|"|$)/);
    }
    const api = readFileSync(join(root, "deploy/api.fly.toml"), "utf8");
    expect(api).toContain('app = "freed-api"');
    expect(api).toContain("[http_service.http_options]");
    expect(api).toContain("idle_timeout = 960");
    expect(readFileSync(join(root, "deploy/web.fly.toml"), "utf8")).toContain(
      'app = "freed-web"',
    );
    expect(
      readFileSync(join(root, "deploy/hindsight.fly.toml"), "utf8"),
    ).toContain('HINDSIGHT_API_WORKER_ID = "freed-memory"');
    const hindsight = readFileSync(
      join(root, "deploy/hindsight.fly.toml"),
      "utf8",
    );
    expect(hindsight).toContain('memory = "2gb"');
    expect(hindsight).toContain('HINDSIGHT_API_HOST = "::"');
    expect(hindsight).toContain('HINDSIGHT_ENABLE_CP = "false"');
    expect(hindsight).toContain('HINDSIGHT_API_WORKER_ENABLED = "true"');
    expect(hindsight).toContain('HINDSIGHT_API_LLM_PROVIDER = "openai-codex"');
    expect(hindsight).toContain(
      'HINDSIGHT_API_CONSOLIDATION_LLM_PARALLELISM = "1"',
    );
    expect(hindsight).toContain(
      'HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP = "false"',
    );
    expect(hindsight).toContain(
      'HINDSIGHT_API_ENABLE_BANK_LLM_HEALTH = "true"',
    );
    expect(hindsight).toContain('CODEX_HOME = "/data/hindsight-codex"');
    expect(hindsight).toContain('source = "freed_hindsight_codex_auth"');
    expect(hindsight).toContain(
      'HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL = "BAAI/bge-small-en-v1.5"',
    );
    expect(hindsight).not.toContain("HINDSIGHT_API_LLM_API_KEY");
    expect(hindsight).not.toContain("HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY");
    expect(hindsight).toContain('path = "/health/ready"');
    expect(hindsight).toContain('path = "/health/live"');
    expect(hindsight).toContain("[checks.ready]");
    expect(hindsight).not.toContain("[[services]]");

    const validatorPath = join(
      root,
      "tests/acceptance/validate-installation.rb",
    );
    expect(
      execFileSync("ruby", [validatorPath], { encoding: "utf8" }),
    ).toContain("0.2.0 valid");
    const workerPath = join(root, "deploy/worker.fly.toml");
    const worker = readFileSync(workerPath, "utf8");
    expect(worker).toContain("[checks.health]");
    expect(worker).not.toContain("[[services]]");
    writeFileSync(
      workerPath,
      worker.replace(
        'source = "freed_codex_auth"',
        'source = "freed_hindsight_codex_auth"',
      ),
    );
    expect(() => execFileSync("ruby", [validatorPath])).toThrow();
    writeFileSync(workerPath, worker);

    const historicalFormatting = readFileSync(validatorPath, "utf8").replace(
      '["control-plane","web","worker"]',
      "['control-plane', 'web', 'worker']",
    );
    writeFileSync(validatorPath, historicalFormatting);
    validateInstallation(root);
    writeFileSync(
      validatorPath,
      historicalFormatting.replace("'worker'", "'untrusted-role'"),
    );
    expect(() => validateInstallation(root)).toThrow(
      /Validator release contract drift/,
    );
  });

  it("upgrades schema v1 to v2 and rolls image fields back around organization edits", () => {
    const root = syntheticInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const v011 = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: v011.hash });

    mkdirSync(join(root, "scripts"), { recursive: true });
    const taggedV011Validator = readFileSync(
      join(
        repositoryRoot,
        "packages/cli/test-fixtures/validators/v0.1.1.validate-installation.rb",
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "scripts/validate-installation.rb"),
      taggedV011Validator,
    );
    validateInstallation(root);
    writeFileSync(
      join(root, "vorton.yaml"),
      readFileSync(join(root, "vorton.yaml"), "utf8").replace(
        "  modules:",
        "  # ORGANIZATION_DESIRED_MARKER\n  modules:",
      ),
    );

    const oldImages = {
      "deploy/api.fly.toml":
        "registry.invalid/vorton-fixture/control-plane@sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "deploy/web.fly.toml": v2Images["deploy/web.fly.toml"],
      "deploy/worker.fly.toml":
        "registry.invalid/vorton-fixture/worker@sha256:2222222222222222222222222222222222222222222222222222222222222222",
      "deploy/hindsight.fly.toml": previousHindsightImage,
    } as const;
    for (const [path, image] of Object.entries(oldImages)) {
      const service = path.split("/").at(-1)!.replace(".fly.toml", "");
      const hindsightProfile =
        service === "hindsight"
          ? '\n[env]\n  HINDSIGHT_API_DATABASE_BACKEND = "postgres"\n  HINDSIGHT_API_LLM_PROVIDER = "replace-with-explicit-provider"\n  HINDSIGHT_API_LLM_MODEL = "replace-with-explicit-model"\n  HINDSIGHT_API_EMBEDDINGS_PROVIDER = "openai"\n  HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL = "replace-with-explicit-embedding-model"\n  HINDSIGHT_API_RERANKER_PROVIDER = "rrf"'
          : "\n[env]";
      writeFileSync(
        join(root, path),
        `# Organization settings\napp = "custom-${service}"\nprimary_region = "ord"\n\n[build]\n  image = "${image}"\n${hindsightProfile}\n  ORGANIZATION_MARKER = "preserve-me"\n  HINDSIGHT_API_WORKER_ID = "moonbase-lab-memory"\n`,
      );
    }
    const legacyDeployment = readFileSync(
      join(root, "deploy/fly.toml"),
      "utf8",
    );

    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.2.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const deploymentActions = upgraded.plan.actions.filter(
      (entry) => entry.ownership === "vorton-image",
    );
    expect(deploymentActions.map((entry) => entry.path).sort()).toEqual([
      "deploy/api.fly.toml",
      "deploy/hindsight.fly.toml",
      "deploy/worker.fly.toml",
    ]);
    expect(
      upgraded.plan.actions
        .filter((entry) => entry.ownership === "vorton-validator")
        .map((entry) => entry.path),
    ).toEqual([
      "scripts/validate-installation.rb",
      "tests/acceptance/validate-installation.rb",
    ]);
    expect(
      upgraded.plan.actions
        .filter((entry) => entry.ownership === "vorton-version")
        .map((entry) => entry.path),
    ).toEqual(["vorton.yaml"]);
    applyPlan({ root, planHash: upgraded.hash });
    validateInstallation(root);
    expect(
      execFileSync(
        "ruby",
        [join(root, "tests/acceptance/validate-installation.rb")],
        { encoding: "utf8" },
      ),
    ).toContain("0.2.0 valid");
    expect(readFileSync(join(root, "vorton.yaml"), "utf8")).toContain(
      "ORGANIZATION_DESIRED_MARKER",
    );
    expect(readFileSync(join(root, "vorton.yaml"), "utf8")).toContain(
      "version: 0.2.0",
    );

    for (const [path, expectedImage] of Object.entries(v2Images)) {
      const content = readFileSync(join(root, path), "utf8");
      expect(buildImage(content)).toBe(expectedImage);
      expect(content).toContain('primary_region = "ord"');
      expect(content).toContain('ORGANIZATION_MARKER = "preserve-me"');
    }
    expect(readFileSync(join(root, "deploy/fly.toml"), "utf8")).toBe(
      legacyDeployment,
    );
    for (const path of [
      "deploy/api.fly.toml",
      "deploy/hindsight.fly.toml",
      "deploy/worker.fly.toml",
    ]) {
      const absolute = join(root, path);
      writeFileSync(
        absolute,
        readFileSync(absolute, "utf8")
          .replace('app = "custom-', 'app = "renamed-')
          .replace('primary_region = "ord"', 'primary_region = "lhr"'),
      );
    }
    writeFileSync(
      join(root, "scripts/validate-installation.rb"),
      readFileSync(
        join(root, "scripts/validate-installation.rb"),
        "utf8",
      ).replace(
        "installed_tool_files =",
        "# LATER_ORGANIZATION_EDIT\ninstalled_tool_files =",
      ),
    );
    writeFileSync(
      join(root, "vorton.yaml"),
      readFileSync(join(root, "vorton.yaml"), "utf8").replace(
        "# ORGANIZATION_DESIRED_MARKER",
        "# ORGANIZATION_DESIRED_MARKER\n  # LATER_ORGANIZATION_EDIT",
      ),
    );
    expect(rollbackPlan({ root, planHash: upgraded.hash }).status).toBe(
      "rolled-back",
    );
    expect(
      buildImage(readFileSync(join(root, "deploy/api.fly.toml"), "utf8")),
    ).toBe(oldImages["deploy/api.fly.toml"]);
    expect(
      buildImage(readFileSync(join(root, "deploy/worker.fly.toml"), "utf8")),
    ).toBe(oldImages["deploy/worker.fly.toml"]);
    expect(
      buildImage(readFileSync(join(root, "deploy/hindsight.fly.toml"), "utf8")),
    ).toBe(oldImages["deploy/hindsight.fly.toml"]);
    for (const path of [
      "deploy/api.fly.toml",
      "deploy/hindsight.fly.toml",
      "deploy/worker.fly.toml",
    ]) {
      const content = readFileSync(join(root, path), "utf8");
      expect(content).toContain('app = "renamed-');
      expect(content).toContain('primary_region = "lhr"');
      expect(content).toContain('ORGANIZATION_MARKER = "preserve-me"');
    }
    expect(readFileSync(join(root, "deploy/fly.toml"), "utf8")).toBe(
      legacyDeployment,
    );
    const rolledBackDesired = readFileSync(join(root, "vorton.yaml"), "utf8");
    expect(rolledBackDesired).toContain("version: 0.1.1");
    expect(rolledBackDesired).toContain("LATER_ORGANIZATION_EDIT");
    const rolledBackValidator = readFileSync(
      join(root, "scripts/validate-installation.rb"),
      "utf8",
    );
    expect(rolledBackValidator).toBe(
      taggedV011Validator.replace(
        "installed_tool_files =",
        "# LATER_ORGANIZATION_EDIT\ninstalled_tool_files =",
      ),
    );
    expect(rolledBackValidator).toContain(
      'lock.fetch("coreMigrationHead").match?(/\\A[a-z0-9_]+\\z/)',
    );
    expect(rolledBackValidator).toContain('["control-plane", "worker"]');
    expect(rolledBackValidator).toContain("LATER_ORGANIZATION_EDIT");
    validateInstallation(root);
    writeFileSync(
      join(root, "scripts/validate-installation.rb"),
      rolledBackValidator.replace(
        'lock.fetch("coreMigrationHead").match?(/\\A[a-z0-9_]+\\z/)',
        'lock.fetch("coreMigrationHead").match?(/.*/)',
      ),
    );
    expect(() => validateInstallation(root)).toThrow(
      /Validator has an unrecognized release contract/,
    );
  });

  it("upgrades 0.2.1 to 0.3.0 with stable planning and exact image-only rollback", () => {
    const previousRelease = JSON.parse(
      readFileSync(releasedManifest("0.2.1"), "utf8"),
    ) as {
      images: Record<string, { reference: string }>;
    };
    const previousImages = {
      "deploy/api.fly.toml": previousRelease.images["control-plane"]!.reference,
      "deploy/web.fly.toml": previousRelease.images.web!.reference,
      "deploy/worker.fly.toml": previousRelease.images.worker!.reference,
      "deploy/hindsight.fly.toml": previousHindsightImage,
    } as const;

    const installLegacyRelease = (
      root: string,
      reviewedMemoryProfile = false,
    ): Record<string, string> => {
      const initialized = planInit({
        root,
        organization: "Freed",
        releaseManifestPath: releasedManifest("0.2.1"),
        releaseRoot: repositoryRoot,
      });
      applyPlan({ root, planHash: initialized.hash });

      const apiPath = join(root, "deploy/api.fly.toml");
      writeFileSync(
        apiPath,
        readFileSync(apiPath, "utf8")
          .replace(
            'VORTON_WORKER_PROVIDER = "codex-subscription"',
            'VORTON_WORKER_PROVIDER = "openai-responses"',
          )
          .replace(
            'VORTON_WORKER_MODEL = "replace-with-explicit-codex-model"',
            'VORTON_WORKER_MODEL = "replace-with-explicit-model"',
          ),
      );
      writeFileSync(
        join(root, "deploy/worker.fly.toml"),
        `app = "freed-worker"
primary_region = "sea"

[build]
  image = "${previousImages["deploy/worker.fly.toml"]}"

[env]
  PORT = "8080"
  VORTON_WORKER_PROVIDER = "openai-responses"
  VORTON_OPENAI_MODEL = "replace-with-explicit-model"
  VORTON_OPENAI_STORE_RESPONSES = "false"
  VORTON_OPENAI_CLASSIFICATION_CEILING = "internal"
`,
      );
      writeFileSync(
        join(root, "deploy/hindsight.fly.toml"),
        `app = "freed-hindsight"
primary_region = "sea"

[build]
  image = "${previousImages["deploy/hindsight.fly.toml"]}"

[env]
  HINDSIGHT_API_HOST = "0.0.0.0"
  HINDSIGHT_API_PORT = "8888"
  HINDSIGHT_API_WORKER_ID = "freed-memory"
  HINDSIGHT_API_DATABASE_BACKEND = "postgres"
  HINDSIGHT_API_LLM_PROVIDER = "replace-with-explicit-provider"
  HINDSIGHT_API_LLM_MODEL = "replace-with-explicit-model"
  HINDSIGHT_API_EMBEDDINGS_PROVIDER = "openai"
  HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL = "replace-with-explicit-embedding-model"
  HINDSIGHT_API_RERANKER_PROVIDER = "rrf"
  HINDSIGHT_API_TENANT_EXTENSION = "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension"
  HINDSIGHT_API_MCP_ENABLED = "false"
  HINDSIGHT_API_LOG_FORMAT = "json"

[[services]]
  internal_port = 8888
  protocol = "tcp"
  auto_start_machines = true
  auto_stop_machines = "stop"
  min_machines_running = 1

  [[services.tcp_checks]]
    interval = "20s"
    timeout = "5s"
    grace_period = "30s"
`,
      );
      if (reviewedMemoryProfile) {
        const reviewedApi = readFileSync(
          join(
            repositoryRoot,
            "templates/installation/deploy/api.fly.toml.tpl",
          ),
          "utf8",
        )
          .replaceAll("{{INSTALLATION_NAME}}", "freed")
          .replaceAll(
            "{{CONTROL_PLANE_IMAGE}}",
            previousImages["deploy/api.fly.toml"],
          )
          .replaceAll("replace-with-explicit-codex-model", "gpt-5.6-terra");
        writeFileSync(join(root, "deploy/api.fly.toml"), reviewedApi);
        const reviewedWorker = readFileSync(
          join(
            repositoryRoot,
            "templates/installation/deploy/worker.fly.toml.tpl",
          ),
          "utf8",
        )
          .replaceAll("{{INSTALLATION_NAME}}", "freed")
          .replaceAll(
            "{{WORKER_IMAGE}}",
            previousImages["deploy/worker.fly.toml"],
          )
          .replaceAll("replace-with-explicit-codex-model", "gpt-5.6-terra");
        writeFileSync(join(root, "deploy/worker.fly.toml"), reviewedWorker);
        const reviewedProfile = readFileSync(
          join(
            repositoryRoot,
            "templates/installation/deploy/hindsight.fly.toml.tpl",
          ),
          "utf8",
        )
          .replaceAll("{{INSTALLATION_NAME}}", "freed")
          .replaceAll("{{HINDSIGHT_WORKER_ID}}", "freed-memory")
          .replaceAll(
            "{{HINDSIGHT_IMAGE}}",
            previousImages["deploy/hindsight.fly.toml"],
          );
        writeFileSync(
          join(root, "deploy/hindsight.fly.toml"),
          `# Organization reviewed for the option-one runtime. Do not deploy before the image upgrade.\n${reviewedProfile}`,
        );
      }
      const taggedValidator = readFileSync(v021ValidatorFixture, "utf8");
      mkdirSync(join(root, "scripts"), { recursive: true });
      for (const path of validatorPaths) {
        writeFileSync(join(root, path), taggedValidator);
      }

      return Object.fromEntries(
        Object.keys(previousImages).map((path) => [
          path,
          readFileSync(join(root, path), "utf8"),
        ]),
      );
    };

    const unpreparedRoot = blankInstallationRoot();
    installLegacyRelease(unpreparedRoot);
    const unpreparedSnapshot = snapshotExistingFiles(unpreparedRoot);
    expect(() =>
      planUpgrade({
        root: unpreparedRoot,
        releaseManifestPath: manifest("0.3.0"),
        releaseRoot: repositoryRoot,
        allowCandidate: true,
      }),
    ).toThrow(
      /Hindsight image upgrade is blocked until the organization lands the reviewed option-one profile/,
    );
    expect(snapshotExistingFiles(unpreparedRoot)).toEqual(unpreparedSnapshot);

    const missingRollbackContractRoot = blankInstallationRoot();
    installLegacyRelease(missingRollbackContractRoot, true);
    for (const path of validatorPaths) {
      const absolute = join(missingRollbackContractRoot, path);
      writeFileSync(
        absolute,
        readFileSync(absolute, "utf8").replace(
          /^\s*"deploy\/hindsight\.fly\.toml"\s*=>\s*"[^"]+",\s*$/m,
          "",
        ),
      );
    }
    expect(() =>
      planUpgrade({
        root: missingRollbackContractRoot,
        releaseManifestPath: manifest("0.3.0"),
        releaseRoot: repositoryRoot,
        allowCandidate: true,
      }),
    ).toThrow(/bind the exact current Hindsight image for rollback/);

    const forgedPlanRoot = blankInstallationRoot();
    installLegacyRelease(forgedPlanRoot, true);
    const legitimatePlan = planUpgrade({
      root: forgedPlanRoot,
      releaseManifestPath: manifest("0.3.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const forgedStoredPlan = JSON.parse(
      readFileSync(legitimatePlan.path, "utf8"),
    ) as {
      planHash: string;
      actions: Array<{
        path: string;
        preimage: string | null;
        postimage: string | null;
        preimageContent: string | null;
        content: string | null;
      }>;
    };
    const forgedHindsightAction = forgedStoredPlan.actions.find(
      (entry) => entry.path === "deploy/hindsight.fly.toml",
    )!;
    const removePortFromEnvironment = (content: string): string =>
      content.replace(
        '  HINDSIGHT_API_PORT = "8888"',
        '  # HINDSIGHT_API_PORT = "8888"',
      );
    forgedHindsightAction.preimageContent = removePortFromEnvironment(
      forgedHindsightAction.preimageContent!,
    );
    forgedHindsightAction.content = removePortFromEnvironment(
      forgedHindsightAction.content!,
    );
    forgedHindsightAction.preimage = sha256(
      forgedHindsightAction.preimageContent,
    );
    forgedHindsightAction.postimage = sha256(forgedHindsightAction.content);
    const { planHash: _discardedHash, ...forgedPlanWithoutHash } =
      forgedStoredPlan;
    forgedStoredPlan.planHash = sha256(canonicalJson(forgedPlanWithoutHash));
    writeFileSync(legitimatePlan.path, canonicalJson(forgedStoredPlan));
    const forgedHindsightPath = join(
      forgedPlanRoot,
      "deploy/hindsight.fly.toml",
    );
    writeFileSync(
      forgedHindsightPath,
      removePortFromEnvironment(readFileSync(forgedHindsightPath, "utf8")),
    );
    const forgedSnapshot = Object.fromEntries(
      Object.entries(snapshotExistingFiles(forgedPlanRoot)).filter(
        ([path]) => !path.startsWith(".vorton/"),
      ),
    );
    expect(() =>
      applyPlan({
        root: forgedPlanRoot,
        planHash: forgedStoredPlan.planHash,
        planPath: legitimatePlan.path,
      }),
    ).toThrow(/HINDSIGHT_API_PORT in \[env]/);
    expect(
      Object.fromEntries(
        Object.entries(snapshotExistingFiles(forgedPlanRoot)).filter(
          ([path]) => !path.startsWith(".vorton/"),
        ),
      ),
    ).toEqual(forgedSnapshot);

    const omittedValidatorRoot = blankInstallationRoot();
    installLegacyRelease(omittedValidatorRoot, true);
    const completeValidatorPlan = planUpgrade({
      root: omittedValidatorRoot,
      releaseManifestPath: manifest("0.3.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const omittedValidatorPlan = JSON.parse(
      readFileSync(completeValidatorPlan.path, "utf8"),
    ) as {
      planHash: string;
      actions: Array<{ path: string }>;
    };
    omittedValidatorPlan.actions = omittedValidatorPlan.actions.filter(
      (entry) =>
        !validatorPaths.includes(entry.path as (typeof validatorPaths)[number]),
    );
    const { planHash: _oldPlanHash, ...omittedValidatorPlanWithoutHash } =
      omittedValidatorPlan;
    omittedValidatorPlan.planHash = sha256(
      canonicalJson(omittedValidatorPlanWithoutHash),
    );
    writeFileSync(
      completeValidatorPlan.path,
      canonicalJson(omittedValidatorPlan),
    );
    const omittedValidatorSnapshot = Object.fromEntries(
      Object.entries(snapshotExistingFiles(omittedValidatorRoot)).filter(
        ([path]) => !path.startsWith(".vorton/"),
      ),
    );
    expect(() =>
      applyPlan({
        root: omittedValidatorRoot,
        planHash: omittedValidatorPlan.planHash,
        planPath: completeValidatorPlan.path,
      }),
    ).toThrow(/planned validator.*current Hindsight image/);
    expect(
      Object.fromEntries(
        Object.entries(snapshotExistingFiles(omittedValidatorRoot)).filter(
          ([path]) => !path.startsWith(".vorton/"),
        ),
      ),
    ).toEqual(omittedValidatorSnapshot);

    const conflictRoot = blankInstallationRoot();
    installLegacyRelease(conflictRoot, true);
    const conflicted = planUpgrade({
      root: conflictRoot,
      releaseManifestPath: manifest("0.3.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const conflictPath = join(conflictRoot, "deploy/worker.fly.toml");
    writeFileSync(
      conflictPath,
      readFileSync(conflictPath, "utf8").replace(
        previousImages["deploy/worker.fly.toml"],
        `registry.invalid/conflict/worker@sha256:${"9".repeat(64)}`,
      ),
    );
    const conflictSnapshot = Object.fromEntries(
      Object.entries(snapshotExistingFiles(conflictRoot)).filter(
        ([path]) => !path.startsWith(".vorton/"),
      ),
    );
    expect(() =>
      applyPlan({ root: conflictRoot, planHash: conflicted.hash }),
    ).toThrow(/Preimage conflict at deploy\/worker\.fly\.toml/);
    expect(
      Object.fromEntries(
        Object.entries(snapshotExistingFiles(conflictRoot)).filter(
          ([path]) => !path.startsWith(".vorton/"),
        ),
      ),
    ).toEqual(conflictSnapshot);

    const root = blankInstallationRoot();
    const legacyDeployments = installLegacyRelease(root, true);
    const legacyValidators = Object.fromEntries(
      validatorPaths.map((path) => [
        path,
        readFileSync(join(root, path), "utf8"),
      ]),
    ) as Record<(typeof validatorPaths)[number], string>;
    const previousHost = readFileSync(
      join(root, "host/aubos-runtime.json"),
      "utf8",
    );
    const previousDesired = readFileSync(join(root, "vorton.yaml"), "utf8");
    const previousLock = readFileSync(join(root, "vorton.lock.json"), "utf8");
    const firstPlan = planUpgrade({
      root,
      releaseManifestPath: manifest("0.3.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const secondPlan = planUpgrade({
      root,
      releaseManifestPath: manifest("0.3.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    expect(secondPlan.hash).toBe(firstPlan.hash);
    expect(firstPlan.plan.actions.map((entry) => entry.path).sort()).toEqual([
      "deploy/api.fly.toml",
      "deploy/hindsight.fly.toml",
      "deploy/web.fly.toml",
      "deploy/worker.fly.toml",
      "host/aubos-runtime.json",
      "host/vorton-runtime.json",
      "scripts/validate-installation.rb",
      "tests/acceptance/validate-installation.rb",
      "vorton.lock.json",
      "vorton.yaml",
    ]);

    expect(applyPlan({ root, planHash: firstPlan.hash }).status).toBe(
      "applied",
    );
    expect(applyPlan({ root, planHash: firstPlan.hash }).status).toBe(
      "already-applied",
    );
    validateInstallation(root);
    expect(
      readFileSync(join(root, "host/vorton-runtime.json"), "utf8"),
    ).toContain('"deploymentContract": 3');
    for (const [path, nextImage] of Object.entries(v3Images) as Array<
      [keyof typeof v3Images, string]
    >) {
      expect(readFileSync(join(root, path), "utf8")).toBe(
        legacyDeployments[path]!.replace(previousImages[path], nextImage),
      );
    }
    for (const path of validatorPaths) {
      expect(readFileSync(join(root, path), "utf8")).toBe(
        legacyValidators[path].replace(previousHindsightImage, hindsightImage),
      );
    }
    const rejectTemporaryMutation = (
      changes: Array<[string, (content: string) => string]>,
      message: RegExp,
    ): void => {
      const originals = changes.map(([path]) => [
        path,
        readFileSync(join(root, path), "utf8"),
      ]) as Array<[string, string]>;
      for (const [path, mutate] of changes) {
        writeFileSync(
          join(root, path),
          mutate(readFileSync(join(root, path), "utf8")),
        );
      }
      expect(() => validateInstallation(root)).toThrow(message);
      for (const [path, content] of originals) {
        writeFileSync(join(root, path), content);
      }
    };
    rejectTemporaryMutation(
      [
        [
          "deploy/hindsight.fly.toml",
          (content) =>
            content.replace(
              '  HINDSIGHT_API_PORT = "8888"',
              '  # HINDSIGHT_API_PORT = "8888"',
            ),
        ],
      ],
      /HINDSIGHT_API_PORT in \[env]/,
    );
    rejectTemporaryMutation(
      [
        [
          "deploy/hindsight.fly.toml",
          (content) => content.replace("[checks.ready]", "# [checks.ready]"),
        ],
      ],
      /top-level ready and live checks/,
    );
    rejectTemporaryMutation(
      [
        [
          "deploy/worker.fly.toml",
          (content) => `${content}\n[http_service]\n  internal_port = 8080\n`,
        ],
      ],
      /Private worker and Hindsight services/,
    );
    rejectTemporaryMutation(
      [
        [
          "deploy/hindsight.fly.toml",
          (content) =>
            `${content}\n[[services]]\n  internal_port = 8888\n  protocol = "tcp"\n`,
        ],
      ],
      /without Fly Proxy services/,
    );
    rejectTemporaryMutation(
      [
        [
          "deploy/hindsight.fly.toml",
          (content) =>
            content.replace("freed_hindsight_codex_auth", "freed_codex_auth"),
        ],
      ],
      /separate auth volumes/,
    );
    rejectTemporaryMutation(
      [
        [
          "deploy/hindsight.fly.toml",
          (content) => content.replace(hindsightImage, previousHindsightImage),
        ],
        ...validatorPaths.map(
          (path) =>
            [
              path,
              (content: string) =>
                content.replace(hindsightImage, previousHindsightImage),
            ] as [string, (content: string) => string],
        ),
      ],
      /Contract-3 installations must bind the current Hindsight image/,
    );
    rejectTemporaryMutation(
      [
        [
          "deploy/worker.fly.toml",
          (content) =>
            content.replace(
              'VORTON_WORKER_PROVIDER = "codex-subscription"',
              'VORTON_WORKER_PROVIDER = "openai-responses"',
            ),
        ],
      ],
      /same subscription provider and exact model/,
    );
    rejectTemporaryMutation(
      [
        [
          "deploy/api.fly.toml",
          (content) =>
            content.replace(
              'VORTON_WORKER_CLASSIFICATION_CEILING = "internal"',
              'VORTON_WORKER_CLASSIFICATION_CEILING = "classified"',
            ),
        ],
        [
          "deploy/worker.fly.toml",
          (content) =>
            content.replace(
              'VORTON_CODEX_CLASSIFICATION_CEILING = "internal"',
              'VORTON_CODEX_CLASSIFICATION_CEILING = "classified"',
            ),
        ],
      ],
      /classification ceilings must match exactly/,
    );
    rejectTemporaryMutation(
      [
        [
          "deploy/api.fly.toml",
          (content) =>
            content.replace(
              'VORTON_WORKER_REQUEST_TIMEOUT_MS = "930000"',
              'VORTON_WORKER_REQUEST_TIMEOUT_MS = "not-a-number"',
            ),
        ],
      ],
      /must be a decimal integer/,
    );
    expect(
      execFileSync(
        "ruby",
        [join(root, "tests/acceptance/validate-installation.rb")],
        { encoding: "utf8" },
      ),
    ).toContain("0.3.0 valid");

    for (const path of Object.keys(previousImages)) {
      const absolute = join(root, path);
      writeFileSync(
        absolute,
        readFileSync(absolute, "utf8").replace(
          'primary_region = "sea"',
          'primary_region = "lhr"',
        ),
      );
    }
    const journalPath = join(root, `.vorton/journals/${firstPlan.hash}.json`);
    const interruptedJournal = JSON.parse(
      readFileSync(journalPath, "utf8"),
    ) as {
      status: string;
      actions: Array<{ path: string; state: string }>;
    };
    const interruptedIndex = interruptedJournal.actions.findIndex(
      (entry) => entry.path === "deploy/worker.fly.toml",
    );
    expect(interruptedIndex).toBeGreaterThan(0);
    interruptedJournal.status = "applying";
    interruptedJournal.actions.forEach((entry, index) => {
      entry.state = index < interruptedIndex ? "applied" : "pending";
    });
    writeFileSync(journalPath, canonicalJson(interruptedJournal));
    expect(applyPlan({ root, planHash: firstPlan.hash }).status).toBe(
      "applied",
    );

    for (const path of Object.keys(previousImages)) {
      const absolute = join(root, path);
      let content = readFileSync(absolute, "utf8").replace(
        'primary_region = "sea"',
        'primary_region = "lhr"',
      );
      if (path === "deploy/hindsight.fly.toml") {
        content = content.replace(
          'HINDSIGHT_API_LLM_PROVIDER = "openai-codex"',
          'HINDSIGHT_API_LLM_PROVIDER = "organization-reviewed-provider"',
        );
      }
      writeFileSync(absolute, `${content}# ORGANIZATION_AFTER_UPGRADE\n`);
    }
    const desiredAfterOrganizationEdit = previousDesired.replace(
      "  modules:",
      "  # ORGANIZATION_AFTER_UPGRADE\n  modules:",
    );
    writeFileSync(
      join(root, "vorton.yaml"),
      readFileSync(join(root, "vorton.yaml"), "utf8").replace(
        "  modules:",
        "  # ORGANIZATION_AFTER_UPGRADE\n  modules:",
      ),
    );
    for (const path of validatorPaths) {
      writeFileSync(
        join(root, path),
        readFileSync(join(root, path), "utf8").replace(
          "installed_tool_files =",
          "# ORGANIZATION_AFTER_UPGRADE\ninstalled_tool_files =",
        ),
      );
    }

    // Simulate termination after rollback restored exact and field-owned
    // preimages but before those journal states were persisted. The retry must
    // recognize each restoration without discarding organization edits.
    writeFileSync(join(root, "host/aubos-runtime.json"), previousHost);
    rmSync(join(root, "host/vorton-runtime.json"));
    writeFileSync(join(root, "vorton.yaml"), desiredAfterOrganizationEdit);
    const hindsightPath = join(root, "deploy/hindsight.fly.toml");
    writeFileSync(
      hindsightPath,
      readFileSync(hindsightPath, "utf8").replace(
        hindsightImage,
        previousHindsightImage,
      ),
    );
    for (const path of validatorPaths) {
      const absolute = join(root, path);
      writeFileSync(
        absolute,
        readFileSync(absolute, "utf8").replace(
          hindsightImage,
          previousHindsightImage,
        ),
      );
    }

    expect(rollbackPlan({ root, planHash: firstPlan.hash }).status).toBe(
      "rolled-back",
    );
    expect(rollbackPlan({ root, planHash: firstPlan.hash })).toEqual({
      status: "already-rolled-back",
      restored: [],
    });
    expect(readFileSync(join(root, "vorton.lock.json"), "utf8")).toBe(
      previousLock,
    );
    expect(readFileSync(join(root, "host/aubos-runtime.json"), "utf8")).toBe(
      previousHost,
    );
    expect(existsSync(join(root, "host/vorton-runtime.json"))).toBe(false);
    expect(readFileSync(join(root, "vorton.yaml"), "utf8")).toBe(
      desiredAfterOrganizationEdit,
    );
    for (const path of Object.keys(previousImages)) {
      let expected = legacyDeployments[path]!.replace(
        'primary_region = "sea"',
        'primary_region = "lhr"',
      );
      if (path === "deploy/hindsight.fly.toml") {
        expected = expected.replace(
          'HINDSIGHT_API_LLM_PROVIDER = "openai-codex"',
          'HINDSIGHT_API_LLM_PROVIDER = "organization-reviewed-provider"',
        );
      }
      expect(readFileSync(join(root, path), "utf8")).toBe(
        `${expected}# ORGANIZATION_AFTER_UPGRADE\n`,
      );
    }
    for (const path of validatorPaths) {
      expect(readFileSync(join(root, path), "utf8")).toBe(
        legacyValidators[path].replace(
          "installed_tool_files =",
          "# ORGANIZATION_AFTER_UPGRADE\ninstalled_tool_files =",
        ),
      );
    }
    validateInstallation(root);
    expect(
      execFileSync(
        "ruby",
        [join(root, "tests/acceptance/validate-installation.rb")],
        { encoding: "utf8" },
      ),
    ).toContain("0.2.1 valid");
  });

  it("preserves a governed organization-owned Hindsight Dockerfile during upgrade", () => {
    const root = blankInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Freed",
      releaseManifestPath: releasedManifest("0.3.0"),
      releaseRoot: repositoryRoot,
    });
    applyPlan({ root, planHash: initialized.hash });

    const hindsightPath = join(root, "deploy/hindsight.fly.toml");
    const compatibilityDirectory = join(
      root,
      "deploy/hindsight-managed-postgres",
    );
    const dockerfilePath = join(compatibilityDirectory, "Dockerfile");
    mkdirSync(compatibilityDirectory, { recursive: true });
    writeFileSync(dockerfilePath, `FROM ${hindsightImage}\n\nUSER hindsight\n`);
    const organizationHindsight = readFileSync(hindsightPath, "utf8").replace(
      `  image = "${hindsightImage}"`,
      '  dockerfile = "hindsight-managed-postgres/Dockerfile"',
    );
    writeFileSync(hindsightPath, organizationHindsight);
    validateInstallation(root);

    const upgraded = planUpgrade({
      root,
      releaseManifestPath: releasedManifest("0.3.1"),
      releaseRoot: repositoryRoot,
    });
    expect(
      upgraded.plan.actions.some(
        (entry) => entry.path === "deploy/hindsight.fly.toml",
      ),
    ).toBe(false);
    applyPlan({ root, planHash: upgraded.hash });
    validateInstallation(root);
    expect(readFileSync(hindsightPath, "utf8")).toBe(organizationHindsight);
    expect(readFileSync(dockerfilePath, "utf8")).toBe(
      `FROM ${hindsightImage}\n\nUSER hindsight\n`,
    );

    writeFileSync(
      dockerfilePath,
      "FROM ghcr.io/vectorize-io/hindsight:latest\n",
    );
    expect(() => validateInstallation(root)).toThrow(
      /must use only the reviewed immutable image as its base/,
    );
    writeFileSync(dockerfilePath, `FROM ${hindsightImage}\n`);
    writeFileSync(
      hindsightPath,
      organizationHindsight.replace(
        'dockerfile = "hindsight-managed-postgres/Dockerfile"',
        'dockerfile = "../Dockerfile"',
      ),
    );
    expect(() => validateInstallation(root)).toThrow(
      /Dockerfile path must be normalized and relative/,
    );
  });

  it("adopts an exact release and resumes an interrupted apply idempotently", () => {
    const root = syntheticInstallationRoot();
    const existingBefore = snapshotExistingFiles(root);
    const planned = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });

    const stored = JSON.parse(readFileSync(planned.path, "utf8")) as {
      planHash: string;
      actions: Array<{
        path: string;
        ownership: "vorton" | "organization";
        operation: "create" | "update" | "delete";
        preimage: string | null;
        postimage: string | null;
        preimageContent: string | null;
        content: string | null;
      }>;
    };
    const journalPath = join(root, `.vorton/journals/${planned.hash}.json`);
    mkdirSync(dirname(journalPath), { recursive: true });
    writeFileSync(
      journalPath,
      canonicalJson({
        schemaVersion: 1,
        planHash: planned.hash,
        status: "applying",
        actions: stored.actions.map((entry) => ({
          ...entry,
          state: "pending",
        })),
      }),
    );

    // Simulate termination after one atomic file write but before its journal
    // state was persisted. The retry recognizes the exact postimage.
    const interruptedAction = stored.actions[0]!;
    expect(interruptedAction.content).not.toBeNull();
    const interruptedPath = join(root, interruptedAction.path);
    mkdirSync(dirname(interruptedPath), { recursive: true });
    writeFileSync(interruptedPath, interruptedAction.content!);

    expect(applyPlan({ root, planHash: planned.hash }).status).toBe("applied");
    expect(applyPlan({ root, planHash: planned.hash }).status).toBe(
      "already-applied",
    );
    validateInstallation(root);
    expect(snapshotExistingFiles(root)).toMatchObject(existingBefore);
    expect(readFileSync(join(root, "vorton.lock.json"), "utf8")).toContain(
      '"version": "0.1.0"',
    );
  });

  it("recovers an interrupted rollback that already removed an upgrade-created deployment", () => {
    const root = blankInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.2.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: upgraded.hash });
    const createdDeployment = upgraded.plan.actions.find(
      (entry) =>
        entry.ownership === "vorton-image" && entry.preimageContent === null,
    );
    expect(createdDeployment).toBeDefined();
    const createdPath = join(root, createdDeployment!.path);
    rmSync(createdPath);

    expect(rollbackPlan({ root, planHash: upgraded.hash }).status).toBe(
      "rolled-back",
    );
    expect(existsSync(createdPath)).toBe(false);
    validateInstallation(root);

    const hostPath = join(root, "host/vorton-runtime.json");
    writeFileSync(hostPath, `${readFileSync(hostPath, "utf8")}\nchanged\n`);
    expect(() => rollbackPlan({ root, planHash: upgraded.hash })).toThrow(
      /Rolled-back file changed since receipt/,
    );
  });

  it("rejects an applied journal containing a pending action before rollback", () => {
    const root = blankInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const applied = applyPlan({ root, planHash: initialized.hash });
    const journal = JSON.parse(readFileSync(applied.journalPath, "utf8")) as {
      status: string;
      actions: Array<{ state: string }>;
    };
    journal.actions[0]!.state = "pending";
    writeFileSync(applied.journalPath, canonicalJson(journal));
    const hostPath = join(root, "host/vorton-runtime.json");
    const hostBefore = readFileSync(hostPath, "utf8");

    expect(() => rollbackPlan({ root, planHash: initialized.hash })).toThrow(
      /Applied journal cannot contain pending actions/,
    );
    expect(readFileSync(hostPath, "utf8")).toBe(hostBefore);
  });

  it("rolls back a fully written applying journal after validation failure", () => {
    const root = blankInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.2.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const previousHost = readFileSync(
      join(root, "host/vorton-runtime.json"),
      "utf8",
    );
    const previousLock = readFileSync(join(root, "vorton.lock.json"), "utf8");

    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.3.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const applied = applyPlan({ root, planHash: upgraded.hash });
    const upgradedHost = readFileSync(
      join(root, "host/vorton-runtime.json"),
      "utf8",
    );
    const apiPath = join(root, "deploy/api.fly.toml");
    writeFileSync(
      apiPath,
      readFileSync(apiPath, "utf8").replace(
        'VORTON_WORKER_CLASSIFICATION_CEILING = "internal"',
        'VORTON_WORKER_CLASSIFICATION_CEILING = "restricted"',
      ),
    );
    expect(() => validateInstallation(root)).toThrow(
      /classification ceilings must match exactly/,
    );

    const journal = JSON.parse(readFileSync(applied.journalPath, "utf8")) as {
      status: string;
      actions: Array<{ state: string }>;
    };
    expect(journal.actions.every((entry) => entry.state === "applied")).toBe(
      true,
    );
    journal.status = "applying";
    writeFileSync(applied.journalPath, canonicalJson(journal));

    const hostPath = join(root, "host/vorton-runtime.json");
    writeFileSync(hostPath, `${upgradedHost}\nCONFLICT\n`);
    expect(() => rollbackPlan({ root, planHash: upgraded.hash })).toThrow(
      /Rollback postimage conflict at host\/vorton-runtime\.json/,
    );
    writeFileSync(hostPath, upgradedHost);

    expect(rollbackPlan({ root, planHash: upgraded.hash }).status).toBe(
      "rolled-back",
    );
    expect(readFileSync(hostPath, "utf8")).toBe(previousHost);
    expect(readFileSync(join(root, "vorton.lock.json"), "utf8")).toBe(
      previousLock,
    );
    const rolledBackApi = readFileSync(apiPath, "utf8");
    expect(buildImage(rolledBackApi)).toBe(v2Images["deploy/api.fly.toml"]);
    expect(rolledBackApi).toContain(
      'VORTON_WORKER_CLASSIFICATION_CEILING = "restricted"',
    );
  });

  it("preserves organization edits to an upgrade-created deployment by refusing deletion", () => {
    const root = blankInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.2.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: upgraded.hash });
    const createdDeployment = upgraded.plan.actions.find(
      (entry) =>
        entry.ownership === "vorton-image" && entry.preimageContent === null,
    );
    expect(createdDeployment).toBeDefined();
    const createdPath = join(root, createdDeployment!.path);
    writeFileSync(
      createdPath,
      `${readFileSync(createdPath, "utf8")}# ORGANIZATION_EDIT\n`,
    );

    expect(() => rollbackPlan({ root, planHash: upgraded.hash })).toThrow(
      new RegExp(`Rollback postimage conflict at ${createdDeployment!.path}`),
    );
    expect(readFileSync(createdPath, "utf8")).toContain("ORGANIZATION_EDIT");
  });

  it("refuses a tampered upgrade preimage before changing any managed file", () => {
    const root = syntheticInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const hostPath = join(root, "host/vorton-runtime.json");
    const lockPath = join(root, "vorton.lock.json");
    const hostBefore = readFileSync(hostPath, "utf8");
    const lockBefore = readFileSync(lockPath, "utf8");
    writeFileSync(hostPath, `${hostBefore}\n# tampered preimage\n`);

    expect(() => applyPlan({ root, planHash: upgraded.hash })).toThrow(
      /Preimage conflict at host\/vorton-runtime\.json/,
    );
    expect(readFileSync(lockPath, "utf8")).toBe(lockBefore);
    expect(readFileSync(hostPath, "utf8")).toContain("tampered preimage");
  });

  it("upgrades one managed host file and narrowly rolls it back", () => {
    const root = syntheticInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const organizationBefore = snapshotOrganizationOwned(root);
    const originalHost = readFileSync(
      join(root, "host/vorton-runtime.json"),
      "utf8",
    );
    const originalLock = readFileSync(join(root, "vorton.lock.json"), "utf8");

    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    expect(upgraded.plan.fromVersion).toBe("0.1.0");
    expect(upgraded.plan.release.version).toBe("0.1.1");
    applyPlan({ root, planHash: upgraded.hash });
    expect(readFileSync(join(root, "vorton.lock.json"), "utf8")).toContain(
      '"lastUpgradeEdge": "0.1.0->0.1.1"',
    );
    expect(
      readFileSync(join(root, "host/vorton-runtime.json"), "utf8"),
    ).toContain('"readinessPath": "/readyz"');
    expect(snapshotOrganizationOwned(root)).toEqual(organizationBefore);

    expect(rollbackPlan({ root, planHash: upgraded.hash })).toEqual({
      status: "rolled-back",
      restored: ["vorton.lock.json", "vorton.yaml", "host/vorton-runtime.json"],
    });
    expect(readFileSync(join(root, "host/vorton-runtime.json"), "utf8")).toBe(
      originalHost,
    );
    expect(readFileSync(join(root, "vorton.lock.json"), "utf8")).toBe(
      originalLock,
    );
    expect(snapshotOrganizationOwned(root)).toEqual(organizationBefore);
  });

  it("refuses rollback after a managed postimage drifts", () => {
    const root = syntheticInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: upgraded.hash });
    const hostPath = join(root, "host/vorton-runtime.json");
    writeFileSync(hostPath, "postimage drift\n");

    expect(() => rollbackPlan({ root, planHash: upgraded.hash })).toThrow(
      /Rollback postimage conflict at host\/vorton-runtime\.json/,
    );
    expect(readFileSync(hostPath, "utf8")).toBe("postimage drift\n");
  });

  it("contains no personal data or secret values", () => {
    const root = syntheticInstallationRoot();
    const planned = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: planned.hash });
    const combined = filesUnder(root)
      .map((path) => `${relative(root, path)}\n${readFileSync(path, "utf8")}`)
      .join("\n");

    expect(combined).not.toMatch(/@(?:gmail|icloud)\.com/i);
    expect(combined).not.toMatch(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}/);
    expect(combined).not.toMatch(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    );
    expect(combined).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
    expect(existsSync(join(root, ".env"))).toBe(false);
    expect(combined).toContain("VORTON_SUPABASE_URL");
    expect(combined).toContain("Moonbase Triage");
    expect(combined).toContain("mode: read-only");
  });
});
