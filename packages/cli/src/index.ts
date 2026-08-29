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
  ownership: z.enum(["aubos", "organization"]),
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

function loadRelease(path: string): ReleaseManifest {
  return releaseManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function releaseDigest(release: ReleaseManifest): string {
  return sha256(canonicalJson(release));
}

function action(
  root: string,
  path: string,
  ownership: "aubos" | "organization",
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
  version: string,
): Record<string, string> {
  const render = (template: string): string =>
    readFileSync(
      safeTarget(releaseRoot, `templates/installation/${template}`),
      "utf8",
    )
      .replaceAll("{{INSTALLATION_NAME}}", name)
      .replaceAll("{{DISPLAY_NAME_JSON}}", JSON.stringify(displayName))
      .replaceAll("{{RELEASE_VERSION}}", version);
  return {
    ".gitignore": render("gitignore.tpl"),
    "aubos.yaml": render("aubos.yaml.tpl"),
    "organization/identity.yaml": render("organization/identity.yaml.tpl"),
    "organization/modules.yaml": render("organization/modules.yaml.tpl"),
    "organization/branding/.gitkeep": "",
    "organization/policies/.gitkeep": "",
    "organization/roles/.gitkeep": "",
    "modules/custom/.gitkeep": "",
    "tools/.gitkeep": "",
    "supabase/migrations/organization/.gitkeep": "",
    "tests/acceptance/.gitkeep": "",
    "deploy/fly.toml": render("deploy/fly.toml.tpl"),
    ".github/workflows/aubos-installation.yml": render(
      "github/aubos-installation.yml.tpl",
    ),
  };
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
}): PlannedResult {
  const release = loadRelease(options.releaseManifestPath);
  const name = slugifyOrganization(options.organization);
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
    release.version,
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
}): PlannedResult {
  const manifestPath = safeTarget(options.root, "aubos.yaml");
  const lockPath = safeTarget(options.root, "aubos.lock.json");
  if (!existsSync(manifestPath) || !existsSync(lockPath)) {
    throw new Error("Upgrade requires aubos.yaml and aubos.lock.json");
  }
  const desired = parseYaml(readFileSync(manifestPath, "utf8")) as {
    metadata?: { name?: unknown };
  };
  const name = z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .parse(desired.metadata?.name);
  const previous = installationLockSchema.parse(
    JSON.parse(readFileSync(lockPath, "utf8")),
  );
  const release = loadRelease(options.releaseManifestPath);
  const managed = managedActions(options.root, options.releaseRoot, release);

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
    actions: [...managed, ...removals, lockAction].sort((left, right) =>
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

export function applyPlan(options: {
  root: string;
  planHash: string;
  planPath?: string;
}): ApplyResult {
  const planPath =
    options.planPath ??
    safeTarget(options.root, `.aubos/plans/${options.planHash}.json`);
  const plan = verifyStoredPlan(planPath, options.planHash);
  plan.actions.forEach(verifyActionContent);
  if (plan.actions.some((entry) => !allowedAction(plan, entry))) {
    throw new Error("Plan contains an action outside AubOS ownership rules");
  }
  const loaded = loadOrCreateJournal(options.root, plan, options.planHash);
  const journal = loaded.journal;
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
}): RollbackResult {
  const path = journalPath(options.root, options.planHash);
  const journal = journalSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (journal.status === "rolled-back") {
    return { status: "already-rolled-back", restored: [] };
  }
  if (journal.status !== "applied") {
    throw new Error("Only a completely applied plan can be rolled back");
  }
  const managed = journal.actions.filter(
    (entry) => entry.ownership === "aubos" && entry.state === "applied",
  );

  for (const entry of managed) {
    const observed = fileDigest(safeTarget(options.root, entry.path));
    if (observed !== entry.postimage) {
      throw new Error(`Rollback postimage conflict at ${entry.path}`);
    }
  }

  const restored: string[] = [];
  for (const entry of [...managed].reverse()) {
    const target = safeTarget(options.root, entry.path);
    if (entry.preimageContent === null) {
      if (existsSync(target)) unlinkSync(target);
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
  for (const [path, expected] of Object.entries(lock.managedFiles)) {
    const observed = fileDigest(safeTarget(root, path));
    if (observed !== expected) {
      throw new Error(
        `Managed file validation failed at ${path}: expected ${expected}, observed ${observed ?? "missing"}`,
      );
    }
  }
}
