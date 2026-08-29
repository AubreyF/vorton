import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  installationLockSchema,
  installationManifestSchema,
  releaseManifestSchema,
  type InstallationLock,
  type ReleaseManifest,
} from "@aubos/contracts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const planPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      value
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        ),
    "must be a normalized relative path",
  );
const actionSchema = z.object({
  path: planPathSchema,
  ownership: z.enum([
    "aubos",
    "aubos-image",
    "aubos-validator",
    "aubos-version",
    "organization",
  ]),
  operation: z.enum(["create", "update", "delete"]),
  preimage: digestSchema.nullable(),
  postimage: digestSchema.nullable(),
  preimageContent: z.string().nullable(),
  content: z.string().nullable(),
});

export const planSchema = z.object({
  schemaVersion: z.literal(1),
  operation: z.enum(["init", "upgrade"]),
  installation: z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    displayName: z.string().min(1),
  }),
  fromVersion: z.string().min(1).nullable(),
  release: releaseManifestSchema,
  releaseManifestDigest: digestSchema,
  actions: z.array(actionSchema),
});

export type DistributionPlan = z.infer<typeof planSchema>;
export type PlanAction = z.infer<typeof actionSchema>;

const storedPlanSchema = planSchema.extend({ planHash: digestSchema });

const journalSchema = z.object({
  schemaVersion: z.literal(1),
  planHash: digestSchema,
  status: z.enum(["applying", "applied", "rolled-back"]),
  actions: z.array(
    actionSchema.extend({
      state: z.enum(["pending", "applied", "rolled-back"]),
    }),
  ),
});

type Journal = z.infer<typeof journalSchema>;

export interface PlannedResult {
  hash: string;
  path: string;
  plan: DistributionPlan;
}

export interface ApplyResult {
  status: "applied" | "already-applied";
  journalPath: string;
}

export interface RollbackResult {
  status: "rolled-back" | "already-rolled-back";
  restored: string[];
}

const HINDSIGHT_IMAGE =
  "ghcr.io/vectorize-io/hindsight@sha256:ac50c0d95a65c88545f46665dc432544bcc378cec89e03675786a1d9383feb2d";

const deploymentImageRoles = {
  "deploy/api.fly.toml": "control-plane",
  "deploy/web.fly.toml": "web",
  "deploy/worker.fly.toml": "worker",
} as const;

const deploymentPaths = [
  "deploy/api.fly.toml",
  "deploy/web.fly.toml",
  "deploy/worker.fly.toml",
  "deploy/hindsight.fly.toml",
] as const;

type DeploymentPath = (typeof deploymentPaths)[number];
type FirstPartyDeploymentPath = keyof typeof deploymentImageRoles;

function firstPartyImageRole(
  path: DeploymentPath,
): (typeof deploymentImageRoles)[FirstPartyDeploymentPath] | null {
  return path === "deploy/hindsight.fly.toml"
    ? null
    : deploymentImageRoles[path];
}

export function sha256(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export function hashPlan(plan: DistributionPlan): string {
  return sha256(canonicalJson(plan));
}

export function slugifyOrganization(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(slug)) return `organization-${slug || "installation"}`;
  return slug;
}

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function fileDigest(path: string): string | null {
  const content = readText(path);
  return content === null ? null : sha256(content);
}

function safeTarget(root: string, relativePath: string): string {
  if (isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw new Error(`Unsafe installation path: ${relativePath}`);
  }
  const absoluteRoot = resolve(root);
  if (existsSync(absoluteRoot) && lstatSync(absoluteRoot).isSymbolicLink()) {
    throw new Error("Installation root cannot be a symbolic link");
  }
  const target = resolve(absoluteRoot, relativePath);
  const relation = relative(absoluteRoot, target);
  if (
    relation.startsWith(`..${sep}`) ||
    relation === ".." ||
    isAbsolute(relation)
  ) {
    throw new Error(`Installation path escapes its root: ${relativePath}`);
  }

  let cursor = dirname(target);
  while (cursor !== absoluteRoot) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(
        `Installation path crosses a symbolic link: ${relativePath}`,
      );
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`Installation target is a symbolic link: ${relativePath}`);
  }
  return target;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.aubos-write-${process.pid}-${Date.now()}`,
  );
  writeFileSync(temporary, content, {
    encoding: "utf8",
    mode: 0o644,
    flag: "wx",
  });
  renameSync(temporary, path);
}

function writeJson(path: string, value: unknown): void {
  atomicWrite(path, canonicalJson(value));
}

function loadRelease(
  path: string,
  expectedCliVersion?: string,
): ReleaseManifest {
  const release = releaseManifestSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (expectedCliVersion && release.cliVersion !== expectedCliVersion) {
    throw new Error(
      `Release manifest requires AubOS CLI ${release.cliVersion}, but the running CLI is ${expectedCliVersion}`,
    );
  }
  return release;
}

function requireReleasedManifest(
  release: ReleaseManifest,
  allowCandidate: boolean | undefined,
): void {
  if (release.status !== "released" && !allowCandidate) {
    throw new Error(
      `Release manifest ${release.version} is ${release.status}, not released`,
    );
  }
}

function releaseDigest(release: ReleaseManifest): string {
  return sha256(canonicalJson(release));
}

function action(
  root: string,
  path: string,
  ownership:
    | "aubos"
    | "aubos-image"
    | "aubos-validator"
    | "aubos-version"
    | "organization",
  content: string | null,
): PlanAction {
  const target = safeTarget(root, path);
  const preimageContent = readText(target);
  const preimage = preimageContent === null ? null : sha256(preimageContent);
  const postimage = content === null ? null : sha256(content);
  return {
    path,
    ownership,
    operation:
      content === null ? "delete" : preimage === null ? "create" : "update",
    preimage,
    postimage,
    preimageContent,
    content,
  };
}

function organizationScaffold(
  releaseRoot: string,
  name: string,
  displayName: string,
  release: ReleaseManifest,
): Record<string, string> {
  const render = (template: string): string =>
    readFileSync(
      safeTarget(releaseRoot, `templates/installation/${template}`),
      "utf8",
    )
      .replaceAll("{{INSTALLATION_NAME}}", name)
      .replaceAll("{{DISPLAY_NAME_JSON}}", JSON.stringify(displayName))
      .replaceAll("{{RELEASE_VERSION}}", release.version)
      .replaceAll("{{RELEASE_SCHEMA_VERSION}}", String(release.schemaVersion))
      .replaceAll(
        "{{EXPECTED_IMAGE_NAMES_RUBY}}",
        JSON.stringify(
          release.schemaVersion === 1
            ? ["control-plane", "worker"]
            : ["control-plane", "web", "worker"],
        ),
      )
      .replaceAll("{{CORE_MIGRATION_HEAD}}", release.coreMigrationHead)
      .replaceAll("{{HINDSIGHT_WORKER_ID}}", `${name}-memory`)
      .replaceAll(
        "{{CONTROL_PLANE_IMAGE}}",
        release.images["control-plane"]?.reference ?? "",
      )
      .replaceAll("{{WEB_IMAGE}}", release.images.web?.reference ?? "")
      .replaceAll("{{WORKER_IMAGE}}", release.images.worker?.reference ?? "")
      .replaceAll("{{HINDSIGHT_IMAGE}}", HINDSIGHT_IMAGE);
  const scaffold: Record<string, string> = {
    ".gitignore": render("gitignore.tpl"),
    "aubos.yaml": render("aubos.yaml.tpl"),
    "organization/identity.yaml": render("organization/identity.yaml.tpl"),
    "organization/modules.yaml": render("organization/modules.yaml.tpl"),
    "organization/memory.yaml": render("organization/memory.yaml.tpl"),
    "organization/policies/authority.yaml": render(
      "organization/policies/authority.yaml.tpl",
    ),
    "organization/branding/.gitkeep": "",
    "organization/roles/README.md": render("organization/roles/README.md.tpl"),
    "modules/custom/.gitkeep": "",
    "tools/README.md": render("tools/README.md.tpl"),
    "supabase/migrations/organization/.gitkeep": "",
    "tests/acceptance/README.md": render("tests/acceptance/README.md.tpl"),
    "tests/acceptance/validate-installation.rb": render(
      "scripts/validate-installation.rb.tpl",
    ),
    ".github/workflows/aubos-installation.yml": render(
      "github/aubos-installation.yml.tpl",
    ),
  };
  if (release.schemaVersion === 1) {
    scaffold["deploy/fly.toml"] = render("deploy/fly.toml.tpl");
  } else {
    for (const path of deploymentPaths) {
      scaffold[path] = render(`${path}.tpl`);
    }
  }
  return scaffold;
}

function replaceDesiredVersion(
  content: string,
  expected: string,
  replacement: string,
): string {
  const parsed = installationManifestSchema.parse(parseYaml(content));
  if (parsed.spec.release.version !== expected) {
    throw new Error(
      `Desired release drift: expected ${expected}, observed ${parsed.spec.release.version}`,
    );
  }
  const lines = content.split("\n");
  let specIndent: number | null = null;
  let releaseIndent: number | null = null;
  let replaced = 0;
  const updated = lines.map((line) => {
    const key = /^(\s*)([A-Za-z][A-Za-z0-9-]*):(?:\s|$)/.exec(line);
    if (key) {
      const indent = key[1]!.length;
      const name = key[2]!;
      if (indent === 0) {
        specIndent = name === "spec" ? indent : null;
        releaseIndent = null;
      } else if (specIndent !== null && indent > specIndent) {
        if (name === "release" && releaseIndent === null) {
          releaseIndent = indent;
        } else if (releaseIndent !== null && indent <= releaseIndent) {
          releaseIndent = null;
        }
      }
    }
    if (releaseIndent === null) return line;
    const version = /^(\s*version:\s*)([^#]*?)(\s*(?:#.*)?)$/.exec(line);
    if (!version || version[1]!.length <= releaseIndent) return line;
    replaced += 1;
    return `${version[1]}${replacement}${version[3]}`;
  });
  if (replaced !== 1) {
    throw new Error(
      `aubos.yaml must contain exactly one spec.release.version field`,
    );
  }
  const result = updated.join("\n");
  const verified = installationManifestSchema.parse(parseYaml(result));
  if (verified.spec.release.version !== replacement) {
    throw new Error(`Failed to update desired release version`);
  }
  return result;
}

const genericMigrationAssertion = `assert(
  lock.fetch("coreMigrationHead").match?(/\\A[a-z0-9_]+\\z/),
  "Invalid core migration head",
)`;

const dynamicImageAssertion = `expected_images = images.key?("web") ? ["control-plane", "web", "worker"] : ["control-plane", "worker"]
assert(images.keys.sort == expected_images, "Unexpected runtime image set")`;

function validatorMigrationAssertion(content: string): string | null {
  const exact = content.match(
    /assert\(lock\.fetch\("coreMigrationHead"\) == "[^"]+", "Unexpected migration head"\)/,
  )?.[0];
  if (exact) return exact;
  return content.includes(genericMigrationAssertion)
    ? genericMigrationAssertion
    : null;
}

function validatorImageAssertion(content: string): string | null {
  const exact = content.match(
    /assert\(images\.keys\.sort == \[[^\]]*\], "Unexpected runtime image set"\)/,
  )?.[0];
  if (exact) return exact;
  return content.includes(dynamicImageAssertion) ? dynamicImageAssertion : null;
}

function validatorContractFragments(content: string): {
  migration: string;
  images: string;
} {
  if (!content.includes("Desired and locked releases differ")) {
    throw new Error(`Validator does not enforce desired and locked versions`);
  }
  const migration = validatorMigrationAssertion(content);
  const images = validatorImageAssertion(content);
  if (!migration || !images) {
    throw new Error(`Validator has an unrecognized release contract`);
  }
  return { migration, images };
}

function parseRubyStringList(value: string): string[] {
  let remaining = value.trim();
  const result: string[] = [];
  while (remaining.length > 0) {
    const item = /^(?:"([a-z][a-z0-9-]*)"|'([a-z][a-z0-9-]*)')/.exec(remaining);
    if (!item) throw new Error(`Validator image roles are not string literals`);
    result.push(item[1] ?? item[2]!);
    remaining = remaining.slice(item[0].length).trimStart();
    if (remaining.length === 0) break;
    if (!remaining.startsWith(",")) {
      throw new Error(`Validator image roles must be comma-separated`);
    }
    remaining = remaining.slice(1).trimStart();
    if (remaining.length === 0) {
      throw new Error(`Validator image roles cannot end with a comma`);
    }
  }
  if (result.length === 0) throw new Error(`Validator image roles are empty`);
  return result;
}

function validatorContractSemantics(
  content: string,
  allowGenericMigration: boolean,
): {
  migrationHead: string | null;
  imageNames: string[];
} {
  const fragments = validatorContractFragments(content);
  const migrationHead =
    /lock\.fetch\("coreMigrationHead"\) == "([a-z0-9_]+)"/.exec(
      fragments.migration,
    )?.[1];
  const imageNamesSource = /images\.keys\.sort == \[([^\]]*)\]/.exec(
    fragments.images,
  )?.[1];
  const recognizedGenericMigration =
    allowGenericMigration && fragments.migration === genericMigrationAssertion;
  if (
    (!migrationHead && !recognizedGenericMigration) ||
    imageNamesSource === undefined
  ) {
    throw new Error(`Validator release assertions are not literal contracts`);
  }
  return {
    migrationHead: migrationHead ?? null,
    imageNames: parseRubyStringList(imageNamesSource),
  };
}

function updateValidatorContract(
  content: string,
  release: ReleaseManifest,
): string {
  const current = validatorContractFragments(content);
  const migration = `assert(lock.fetch("coreMigrationHead") == "${release.coreMigrationHead}", "Unexpected migration head")`;
  const imageNames =
    release.schemaVersion === 1
      ? ["control-plane", "worker"]
      : ["control-plane", "web", "worker"];
  const images = `assert(images.keys.sort == ${JSON.stringify(imageNames)}, "Unexpected runtime image set")`;
  return content
    .replace(current.migration, migration)
    .replace(current.images, images);
}

function normalizeValidatorContract(content: string): string {
  const fragments = validatorContractFragments(content);
  return content
    .replace(fragments.migration, "{{AUBOS_MIGRATION_CONTRACT}}")
    .replace(fragments.images, "{{AUBOS_IMAGE_CONTRACT}}");
}

function restoreValidatorContract(
  current: string,
  applied: string,
  previous: string,
): string {
  const currentFragments = validatorContractFragments(current);
  const appliedFragments = validatorContractFragments(applied);
  const previousFragments = validatorContractFragments(previous);
  if (
    currentFragments.migration !== appliedFragments.migration ||
    currentFragments.images !== appliedFragments.images
  ) {
    throw new Error(`Validator release contract changed after apply`);
  }
  return current
    .replace(currentFragments.migration, previousFragments.migration)
    .replace(currentFragments.images, previousFragments.images);
}

function buildImage(content: string, path: string): string {
  const lines = content.split("\n");
  let inBuild = false;
  const images: string[] = [];
  for (const line of lines) {
    const section = /^\s*\[([^\]]+)]\s*$/.exec(line);
    if (section) {
      inBuild = section[1] === "build";
      continue;
    }
    if (!inBuild) continue;
    const image = /^\s*image\s*=\s*"([^"]+)"\s*$/.exec(line);
    if (image) images.push(image[1]!);
  }
  if (images.length !== 1) {
    throw new Error(
      `Fly configuration ${path} must contain exactly one [build] image`,
    );
  }
  return images[0]!;
}

function quotedTomlValue(content: string, key: string, path: string): string {
  const expression = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, "gm");
  const values = [...content.matchAll(expression)].map((match) => match[1]!);
  if (values.length !== 1) {
    throw new Error(
      `Fly configuration ${path} must contain exactly one ${key}`,
    );
  }
  return values[0]!;
}

function replaceBuildImage(
  content: string,
  path: string,
  expected: string,
  replacement: string,
): string {
  const observed = buildImage(content, path);
  if (observed !== expected) {
    throw new Error(
      `Deployment image drift at ${path}: expected ${expected}, observed ${observed}`,
    );
  }
  let inBuild = false;
  let replaced = false;
  return content
    .split("\n")
    .map((line) => {
      const section = /^\s*\[([^\]]+)]\s*$/.exec(line);
      if (section) {
        inBuild = section[1] === "build";
        return line;
      }
      if (!inBuild || !/^\s*image\s*=\s*"[^"]+"\s*$/.test(line)) {
        return line;
      }
      if (replaced) {
        throw new Error(`Multiple deployment image fields at ${path}`);
      }
      replaced = true;
      return line.replace(`"${expected}"`, `"${replacement}"`);
    })
    .join("\n");
}

function imageForDeploymentPath(
  release: ReleaseManifest,
  path: DeploymentPath,
): string {
  if (path === "deploy/hindsight.fly.toml") return HINDSIGHT_IMAGE;
  const role = firstPartyImageRole(path)!;
  const image = release.images[role];
  if (!image) {
    throw new Error(
      `Schema-v2 release ${release.version} is missing the ${role} image`,
    );
  }
  return image.reference;
}

function deploymentUpgradeActions(
  root: string,
  releaseRoot: string,
  name: string,
  previous: InstallationLock,
  release: ReleaseManifest,
): PlanAction[] {
  if (release.schemaVersion !== 2) return [];
  const scaffold = organizationScaffold(releaseRoot, name, name, release);
  return deploymentPaths.flatMap((path) => {
    const target = safeTarget(root, path);
    const existing = readText(target);
    const nextImage = imageForDeploymentPath(release, path);
    if (existing === null) {
      return [action(root, path, "aubos-image", scaffold[path]!)];
    }
    const previousImage =
      path === "deploy/hindsight.fly.toml"
        ? HINDSIGHT_IMAGE
        : previous.images[firstPartyImageRole(path)!]?.reference;
    if (!previousImage) {
      if (buildImage(existing, path) === nextImage) return [];
      throw new Error(
        `Cannot prove ownership of preexisting deployment image at ${path}`,
      );
    }
    const updated = replaceBuildImage(existing, path, previousImage, nextImage);
    return updated === existing
      ? []
      : [action(root, path, "aubos-image", updated)];
  });
}

function validatorUpgradeActions(
  root: string,
  release: ReleaseManifest,
): PlanAction[] {
  return [
    "tests/acceptance/validate-installation.rb",
    "scripts/validate-installation.rb",
  ].flatMap((path) => {
    const existing = readText(safeTarget(root, path));
    if (existing === null) return [];
    const updated = updateValidatorContract(existing, release);
    return updated === existing
      ? []
      : [action(root, path, "aubos-validator", updated)];
  });
}

function managedActions(
  root: string,
  releaseRoot: string,
  release: ReleaseManifest,
): PlanAction[] {
  return release.managedFiles
    .map((file) => {
      const templatePath = safeTarget(releaseRoot, file.template);
      const content = readFileSync(templatePath, "utf8");
      if (sha256(content) !== file.digest) {
        throw new Error(`Template digest mismatch: ${file.template}`);
      }
      return action(root, file.path, "aubos", content);
    })
    .sort((left, right) => compareText(left.path, right.path));
}

function installationLock(
  release: ReleaseManifest,
  manifestDigest: string,
  managed: PlanAction[],
  lastUpgradeEdge: string | null,
): InstallationLock {
  return installationLockSchema.parse({
    schemaVersion: 1,
    release: {
      version: release.version,
      sourceCommit: release.sourceCommit,
      manifestDigest,
    },
    images: release.images,
    contracts: release.contracts,
    coreMigrationHead: release.coreMigrationHead,
    managedFiles: Object.fromEntries(
      managed
        .filter((entry) => entry.postimage !== null)
        .map((entry) => [entry.path, entry.postimage]),
    ),
    lastUpgradeEdge,
  });
}

function persistPlan(root: string, plan: DistributionPlan): PlannedResult {
  const hash = hashPlan(plan);
  const path = safeTarget(root, `.aubos/plans/${hash}.json`);
  writeJson(path, { ...plan, planHash: hash });
  return { hash, path, plan };
}

export function planInit(options: {
  root: string;
  organization: string;
  releaseManifestPath: string;
  releaseRoot: string;
  allowCandidate?: boolean;
  cliVersion?: string;
}): PlannedResult {
  const release = loadRelease(options.releaseManifestPath, options.cliVersion);
  requireReleasedManifest(release, options.allowCandidate);
  const name = slugifyOrganization(options.organization);
  const existingManifestPath = safeTarget(options.root, "aubos.yaml");
  if (existsSync(existingManifestPath)) {
    const existingManifest = installationManifestSchema.parse(
      parseYaml(readFileSync(existingManifestPath, "utf8")),
    );
    if (existingManifest.metadata.name !== name) {
      throw new Error(
        `Existing aubos.yaml names ${existingManifest.metadata.name}, not ${name}`,
      );
    }
    if (existingManifest.spec.release.version !== release.version) {
      throw new Error(
        `Existing aubos.yaml pins ${existingManifest.spec.release.version}, not ${release.version}`,
      );
    }
  }
  for (const path of [
    "aubos.lock.json",
    ...release.managedFiles.map((file) => file.path),
  ]) {
    if (existsSync(safeTarget(options.root, path))) {
      throw new Error(`Initial adoption collision at ${path}`);
    }
  }
  const managed = managedActions(options.root, options.releaseRoot, release);
  const scaffold = organizationScaffold(
    options.releaseRoot,
    name,
    options.organization,
    release,
  );
  const organizationActions = Object.entries(scaffold)
    .filter(([path]) => !existsSync(safeTarget(options.root, path)))
    .map(([path, content]) =>
      action(options.root, path, "organization", content),
    )
    .sort((left, right) => compareText(left.path, right.path));
  const manifestDigest = releaseDigest(release);
  const lock = installationLock(release, manifestDigest, managed, null);
  const lockAction = action(
    options.root,
    "aubos.lock.json",
    "aubos",
    canonicalJson(lock),
  );
  const plan = planSchema.parse({
    schemaVersion: 1,
    operation: "init",
    installation: { name, displayName: options.organization },
    fromVersion: null,
    release,
    releaseManifestDigest: manifestDigest,
    actions: [...organizationActions, ...managed, lockAction],
  });
  return persistPlan(options.root, plan);
}

export function planUpgrade(options: {
  root: string;
  releaseManifestPath: string;
  releaseRoot: string;
  allowCandidate?: boolean;
  cliVersion?: string;
}): PlannedResult {
  const manifestPath = safeTarget(options.root, "aubos.yaml");
  const lockPath = safeTarget(options.root, "aubos.lock.json");
  if (!existsSync(manifestPath) || !existsSync(lockPath)) {
    throw new Error("Upgrade requires aubos.yaml and aubos.lock.json");
  }
  const desiredContent = readFileSync(manifestPath, "utf8");
  const desired = installationManifestSchema.parse(parseYaml(desiredContent));
  const name = desired.metadata.name;
  const previous = installationLockSchema.parse(
    JSON.parse(readFileSync(lockPath, "utf8")),
  );
  const release = loadRelease(options.releaseManifestPath, options.cliVersion);
  requireReleasedManifest(release, options.allowCandidate);
  if (desired.spec.release.version !== previous.release.version) {
    throw new Error(
      `Desired release ${desired.spec.release.version} does not match locked release ${previous.release.version}`,
    );
  }
  const desiredVersion = action(
    options.root,
    "aubos.yaml",
    "aubos-version",
    replaceDesiredVersion(
      desiredContent,
      previous.release.version,
      release.version,
    ),
  );
  const validators = validatorUpgradeActions(options.root, release);
  const managed = managedActions(options.root, options.releaseRoot, release);
  const deployment = deploymentUpgradeActions(
    options.root,
    options.releaseRoot,
    name,
    previous,
    release,
  );

  for (const [path, expected] of Object.entries(previous.managedFiles)) {
    const observed = fileDigest(safeTarget(options.root, path));
    if (observed !== expected) {
      throw new Error(
        `Managed file drift at ${path}: expected ${expected}, observed ${observed ?? "missing"}`,
      );
    }
  }

  for (const entry of managed) {
    if (!(entry.path in previous.managedFiles) && entry.preimage !== null) {
      throw new Error(
        `New managed file collides with an existing path: ${entry.path}`,
      );
    }
  }

  const nextPaths = new Set(managed.map((entry) => entry.path));
  const removals = Object.keys(previous.managedFiles)
    .filter((path) => !nextPaths.has(path))
    .map((path) => action(options.root, path, "aubos", null));
  const manifestDigest = releaseDigest(release);
  const lock = installationLock(
    release,
    manifestDigest,
    managed,
    `${previous.release.version}->${release.version}`,
  );
  const lockAction = action(
    options.root,
    "aubos.lock.json",
    "aubos",
    canonicalJson(lock),
  );
  const plan = planSchema.parse({
    schemaVersion: 1,
    operation: "upgrade",
    installation: { name, displayName: name },
    fromVersion: previous.release.version,
    release,
    releaseManifestDigest: manifestDigest,
    actions: [
      ...managed,
      ...removals,
      ...deployment,
      ...validators,
      desiredVersion,
      lockAction,
    ].sort((left, right) =>
      left.path === "aubos.lock.json"
        ? 1
        : right.path === "aubos.lock.json"
          ? -1
          : compareText(left.path, right.path),
    ),
  });
  return persistPlan(options.root, plan);
}

function allowedAction(plan: DistributionPlan, entry: PlanAction): boolean {
  if (entry.ownership === "organization") {
    const organizationOwned =
      entry.path === ".gitignore" ||
      entry.path === "aubos.yaml" ||
      entry.path.startsWith("organization/") ||
      entry.path.startsWith("modules/custom/") ||
      entry.path.startsWith("tools/") ||
      entry.path.startsWith("supabase/migrations/organization/") ||
      entry.path.startsWith("deploy/") ||
      entry.path.startsWith("tests/acceptance/") ||
      entry.path.startsWith(".github/workflows/");
    return (
      plan.operation === "init" &&
      entry.operation === "create" &&
      organizationOwned
    );
  }
  if (entry.ownership === "aubos-image") {
    if (
      plan.operation !== "upgrade" ||
      entry.operation === "delete" ||
      !deploymentPaths.includes(entry.path as DeploymentPath) ||
      entry.content === null
    ) {
      return false;
    }
    const path = entry.path as DeploymentPath;
    if (
      buildImage(entry.content, path) !==
      imageForDeploymentPath(plan.release, path)
    ) {
      return false;
    }
    if (entry.preimageContent !== null) {
      const beforeImage = buildImage(entry.preimageContent, path);
      const restored = replaceBuildImage(
        entry.content,
        path,
        imageForDeploymentPath(plan.release, path),
        beforeImage,
      );
      if (restored !== entry.preimageContent) return false;
    }
    return true;
  }
  if (entry.ownership === "aubos-version") {
    return (
      plan.operation === "upgrade" &&
      entry.path === "aubos.yaml" &&
      entry.operation === "update" &&
      entry.preimageContent !== null &&
      entry.content !== null &&
      plan.fromVersion !== null &&
      replaceDesiredVersion(
        entry.preimageContent,
        plan.fromVersion,
        plan.release.version,
      ) === entry.content
    );
  }
  if (entry.ownership === "aubos-validator") {
    return (
      plan.operation === "upgrade" &&
      (entry.path === "tests/acceptance/validate-installation.rb" ||
        entry.path === "scripts/validate-installation.rb") &&
      entry.operation === "update" &&
      entry.preimageContent !== null &&
      entry.content !== null &&
      updateValidatorContract(entry.preimageContent, plan.release) ===
        entry.content &&
      normalizeValidatorContract(entry.preimageContent) ===
        normalizeValidatorContract(entry.content)
    );
  }
  return entry.path === "aubos.lock.json" || entry.path.startsWith("host/");
}

function verifyActionContent(entry: PlanAction): void {
  const expectedPreimage =
    entry.preimageContent === null ? null : sha256(entry.preimageContent);
  const expectedPostimage =
    entry.content === null ? null : sha256(entry.content);
  const expectedOperation =
    entry.content === null
      ? "delete"
      : entry.preimage === null
        ? "create"
        : "update";
  if (
    entry.preimage !== expectedPreimage ||
    entry.postimage !== expectedPostimage ||
    entry.operation !== expectedOperation
  ) {
    throw new Error(`Plan action content mismatch at ${entry.path}`);
  }
}

function journalPath(root: string, planHash: string): string {
  return safeTarget(root, `.aubos/journals/${planHash}.json`);
}

function verifyStoredPlan(
  path: string,
  expectedHash: string,
  expectedCliVersion?: string,
): DistributionPlan {
  const stored = storedPlanSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const { planHash, ...plan } = stored;
  const observed = hashPlan(plan);
  if (planHash !== observed || expectedHash !== observed) {
    throw new Error(
      `Plan hash mismatch: expected ${expectedHash}, observed ${observed}`,
    );
  }
  if (releaseDigest(plan.release) !== plan.releaseManifestDigest) {
    throw new Error("Embedded release manifest digest mismatch");
  }
  if (expectedCliVersion && plan.release.cliVersion !== expectedCliVersion) {
    throw new Error(
      `Release manifest requires AubOS CLI ${plan.release.cliVersion}, but the running CLI is ${expectedCliVersion}`,
    );
  }
  return plan;
}

function loadOrCreateJournal(
  root: string,
  plan: DistributionPlan,
  planHash: string,
): { journal: Journal; existed: boolean } {
  const path = journalPath(root, planHash);
  if (existsSync(path)) {
    const journal = journalSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (journal.planHash !== planHash)
      throw new Error("Journal plan hash mismatch");
    return { journal, existed: true };
  }
  const journal: Journal = {
    schemaVersion: 1,
    planHash,
    status: "applying",
    actions: plan.actions.map((entry) => ({ ...entry, state: "pending" })),
  };
  writeJson(path, journal);
  return { journal, existed: false };
}

function verifyJournalMatchesPlan(
  journal: Journal,
  plan: DistributionPlan,
  planHash: string,
): void {
  if (journal.planHash !== planHash) {
    throw new Error("Journal plan hash mismatch");
  }
  if (journal.actions.length !== plan.actions.length) {
    throw new Error("Journal actions do not match the plan");
  }
  for (const [index, journalAction] of journal.actions.entries()) {
    const { state: _state, ...actionWithoutState } = journalAction;
    if (
      canonicalJson(actionWithoutState) !== canonicalJson(plan.actions[index])
    ) {
      throw new Error(
        `Journal action does not match the plan at ${journalAction.path}`,
      );
    }
  }
  let sawPending = false;
  for (const entry of journal.actions) {
    if (entry.state === "pending") sawPending = true;
    if (sawPending && entry.state === "applied") {
      throw new Error("Journal applied states must form a completed prefix");
    }
  }
}

export function applyPlan(options: {
  root: string;
  planHash: string;
  planPath?: string;
  cliVersion?: string;
}): ApplyResult {
  const planPath =
    options.planPath ??
    safeTarget(options.root, `.aubos/plans/${options.planHash}.json`);
  const plan = verifyStoredPlan(planPath, options.planHash, options.cliVersion);
  plan.actions.forEach(verifyActionContent);
  if (plan.actions.some((entry) => !allowedAction(plan, entry))) {
    throw new Error("Plan contains an action outside AubOS ownership rules");
  }
  const loaded = loadOrCreateJournal(options.root, plan, options.planHash);
  const journal = loaded.journal;
  verifyJournalMatchesPlan(journal, plan, options.planHash);
  const receiptPath = journalPath(options.root, options.planHash);

  if (journal.status === "rolled-back") {
    throw new Error(
      "A rolled-back plan cannot be applied again; create a new plan",
    );
  }

  for (const entry of journal.actions) {
    const target = safeTarget(options.root, entry.path);
    const observed = fileDigest(target);
    if (entry.state === "applied") {
      if (entry.ownership === "organization") continue;
      if (observed !== entry.postimage) {
        throw new Error(`Applied file changed since receipt: ${entry.path}`);
      }
      continue;
    }
    if (loaded.existed && observed === entry.postimage) {
      entry.state = "applied";
      continue;
    }
    if (observed !== entry.preimage) {
      throw new Error(
        `Preimage conflict at ${entry.path}: expected ${entry.preimage ?? "missing"}, observed ${observed ?? "missing"}`,
      );
    }
  }

  const alreadyApplied = journal.actions.every(
    (entry) => entry.state === "applied",
  );
  if (alreadyApplied && journal.status === "applied") {
    return { status: "already-applied", journalPath: receiptPath };
  }

  for (const entry of journal.actions) {
    if (entry.state === "applied") continue;
    const target = safeTarget(options.root, entry.path);
    if (entry.content === null) {
      if (existsSync(target)) unlinkSync(target);
    } else {
      atomicWrite(target, entry.content);
    }
    entry.state = "applied";
    writeJson(receiptPath, journal);
  }
  journal.status = "applied";
  writeJson(receiptPath, journal);
  return { status: "applied", journalPath: receiptPath };
}

export function rollbackPlan(options: {
  root: string;
  planHash: string;
  cliVersion?: string;
}): RollbackResult {
  const storedPlanPath = safeTarget(
    options.root,
    `.aubos/plans/${options.planHash}.json`,
  );
  const plan = verifyStoredPlan(
    storedPlanPath,
    options.planHash,
    options.cliVersion,
  );
  const path = journalPath(options.root, options.planHash);
  const journal = journalSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  verifyJournalMatchesPlan(journal, plan, options.planHash);
  if (journal.status === "rolled-back") {
    return { status: "already-rolled-back", restored: [] };
  }
  if (journal.status !== "applied") {
    throw new Error("Only a completely applied plan can be rolled back");
  }
  const managed = journal.actions.filter(
    (entry) =>
      (entry.ownership === "aubos" ||
        entry.ownership === "aubos-image" ||
        entry.ownership === "aubos-validator" ||
        entry.ownership === "aubos-version") &&
      entry.state === "applied",
  );

  for (const entry of managed) {
    const target = safeTarget(options.root, entry.path);
    const observed = fileDigest(target);
    const imageFieldMatches =
      entry.ownership === "aubos-image" &&
      entry.preimageContent !== null &&
      entry.content !== null &&
      readText(target) !== null &&
      buildImage(readText(target)!, entry.path) ===
        buildImage(entry.content, entry.path);
    const versionFieldMatches =
      entry.ownership === "aubos-version" &&
      readText(target) !== null &&
      installationManifestSchema.parse(parseYaml(readText(target)!)).spec
        .release.version === plan.release.version;
    const validatorFieldsMatch =
      entry.ownership === "aubos-validator" &&
      entry.content !== null &&
      readText(target) !== null &&
      validatorContractFragments(readText(target)!).migration ===
        validatorContractFragments(entry.content).migration &&
      validatorContractFragments(readText(target)!).images ===
        validatorContractFragments(entry.content).images;
    if (
      !imageFieldMatches &&
      !versionFieldMatches &&
      !validatorFieldsMatch &&
      observed !== entry.postimage
    ) {
      throw new Error(`Rollback postimage conflict at ${entry.path}`);
    }
  }

  const restored: string[] = [];
  for (const entry of [...managed].reverse()) {
    const target = safeTarget(options.root, entry.path);
    if (entry.preimageContent === null) {
      if (existsSync(target)) unlinkSync(target);
    } else if (entry.ownership === "aubos-image" && entry.content !== null) {
      const current = readText(target)!;
      atomicWrite(
        target,
        replaceBuildImage(
          current,
          entry.path,
          buildImage(entry.content, entry.path),
          buildImage(entry.preimageContent, entry.path),
        ),
      );
    } else if (entry.ownership === "aubos-version" && entry.content !== null) {
      const current = readText(target)!;
      atomicWrite(
        target,
        replaceDesiredVersion(current, plan.release.version, plan.fromVersion!),
      );
    } else if (
      entry.ownership === "aubos-validator" &&
      entry.content !== null
    ) {
      atomicWrite(
        target,
        restoreValidatorContract(
          readText(target)!,
          entry.content,
          entry.preimageContent,
        ),
      );
    } else {
      atomicWrite(target, entry.preimageContent);
    }
    entry.state = "rolled-back";
    restored.push(entry.path);
    writeJson(path, journal);
  }
  journal.status = "rolled-back";
  writeJson(path, journal);
  return { status: "rolled-back", restored };
}

export function cleanSyntheticRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export function validateInstallation(root: string): void {
  const manifest = installationManifestSchema.parse(
    parseYaml(readFileSync(safeTarget(root, "aubos.yaml"), "utf8")),
  );
  const lock = installationLockSchema.parse(
    JSON.parse(readFileSync(safeTarget(root, "aubos.lock.json"), "utf8")),
  );
  if (manifest.spec.deployment.provider !== "fly") {
    throw new Error("Wave 1 supports only the Fly deployment contract");
  }
  if (manifest.spec.release.version !== lock.release.version) {
    throw new Error(
      `Desired release ${manifest.spec.release.version} does not match locked release ${lock.release.version}`,
    );
  }
  if (!/^[a-z0-9_]+$/.test(lock.coreMigrationHead)) {
    throw new Error(`Invalid core migration head: ${lock.coreMigrationHead}`);
  }
  const expectedImageNames = lock.images.web
    ? ["control-plane", "web", "worker"]
    : ["control-plane", "worker"];
  // Released schema-v1 installations used the exact generic migration-format
  // assertion. Schema-v2 is distinguishable by its required web image and must
  // bind the validator to the literal current migration head.
  const allowGenericMigration = !lock.images.web;
  const imageNames = Object.keys(lock.images).sort();
  if (
    imageNames.length !== expectedImageNames.length ||
    imageNames.some((name, index) => name !== expectedImageNames[index])
  ) {
    throw new Error(`Unexpected runtime image set: ${imageNames.join(", ")}`);
  }
  let validatorCount = 0;
  for (const validatorPath of [
    "tests/acceptance/validate-installation.rb",
    "scripts/validate-installation.rb",
  ]) {
    const validator = readText(safeTarget(root, validatorPath));
    if (validator === null) continue;
    validatorCount += 1;
    const contract = validatorContractSemantics(
      validator,
      allowGenericMigration,
    );
    if (
      (contract.migrationHead !== null &&
        contract.migrationHead !== lock.coreMigrationHead) ||
      contract.imageNames.length !== expectedImageNames.length ||
      contract.imageNames.some(
        (name, index) => name !== expectedImageNames[index],
      )
    ) {
      throw new Error(`Validator release contract drift at ${validatorPath}`);
    }
  }
  if (validatorCount === 0) {
    throw new Error(`Installation has no recognized Ruby validation contract`);
  }
  for (const [path, expected] of Object.entries(lock.managedFiles)) {
    const observed = fileDigest(safeTarget(root, path));
    if (observed !== expected) {
      throw new Error(
        `Managed file validation failed at ${path}: expected ${expected}, observed ${observed ?? "missing"}`,
      );
    }
  }
  if (lock.images.web) {
    for (const path of deploymentPaths) {
      const content = readFileSync(safeTarget(root, path), "utf8");
      const observed = buildImage(content, path);
      const expected =
        path === "deploy/hindsight.fly.toml"
          ? HINDSIGHT_IMAGE
          : lock.images[firstPartyImageRole(path)!]?.reference;
      if (!expected || observed !== expected) {
        throw new Error(
          `Deployment image validation failed at ${path}: expected ${expected ?? "missing"}, observed ${observed}`,
        );
      }
      if (/^\s*dockerfile\s*=/m.test(content)) {
        throw new Error(`Source build is forbidden at ${path}`);
      }
      if (path === "deploy/hindsight.fly.toml") {
        const workerId = quotedTomlValue(
          content,
          "HINDSIGHT_API_WORKER_ID",
          path,
        );
        const expectedWorkerId = `${manifest.metadata.name}-memory`;
        if (workerId !== expectedWorkerId || workerId.length < 8) {
          throw new Error(
            `Invalid Hindsight worker ID at ${path}: expected ${expectedWorkerId}`,
          );
        }
      }
    }
  }
}
