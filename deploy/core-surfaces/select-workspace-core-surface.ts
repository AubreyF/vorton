import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

import {
  canonicalWorkspaceCoreSurfaceSelectionJson,
  deriveWorkspaceCoreSurface,
  hashWorkspaceCoreSurface,
  parseWorkspaceCoreSurfaceSelectionApprovalCreation,
  parseWorkspaceCoreSurfaceSelectionReceipt,
  projectWorkspaceCoreSurface,
  workspaceCoreSurfaceSelectionCanonicalSha256,
  workspaceCoreSurfaceSelectionApprovalRequestSchema,
  workspaceCoreSurfaceSelectionReceiptReferenceSchema,
  workspaceCoreSurfacePreferencesSchema,
  workspaceCompiledCoreSurfaceRegistrySha256,
  type WorkspaceCoreSurfaceSelectionApprovalCreation,
  type WorkspaceCoreSurfaceSelectionReceipt,
  type WorkspaceCoreSurfaceSelectionReceiptReference,
  type WorkspaceCoreSurfacePreferences,
  type WorkspaceCoreSurface,
} from "@vorton/contracts";

export const workspaceCoreSurfaceSelectionPlanContract =
  "vorton.select-workspace-core-surface.v1" as const;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumJsonBytes = 256 * 1024;

interface WorkspaceCoreSurfaceSelectionPlanCore {
  contract: typeof workspaceCoreSurfaceSelectionPlanContract;
  operation: "select-workspace-core-surface";
  vortonInstallationId: string;
  workspaceId: string;
  approval: {
    approvalId: string;
    workId: string;
    capabilityGrantId: string;
    expiresAt: string;
  };
  transition: {
    currentSurface: WorkspaceCoreSurface;
    currentSurfaceSha256: string;
    compiledRegistrySha256: string;
    predecessorCoreSurfaceSelectionReceipt: WorkspaceCoreSurfaceSelectionReceiptReference | null;
    targetPreferences: WorkspaceCoreSurfacePreferences;
    targetSurface: WorkspaceCoreSurface;
    targetSurfaceSha256: string;
  };
  scope: {
    compiledCoreSurfaceOnly: true;
    moduleReleaseAdmission: false;
    infrastructureMutation: false;
    otherWorkspaceMutation: false;
  };
  rollback: {
    separateApprovalRequired: true;
    ungatedRollbackCommand: false;
  };
}

export interface WorkspaceCoreSurfaceSelectionPlan extends WorkspaceCoreSurfaceSelectionPlanCore {
  planHash: string;
}

export interface WorkspaceCoreSurfaceSelectionPlanInput {
  vortonInstallationId: string;
  workspaceId: string;
  approvalId: string;
  workId: string;
  capabilityGrantId: string;
  expiresAt: string;
  currentSurface: unknown;
  predecessorCoreSurfaceSelectionReceipt: WorkspaceCoreSurfaceSelectionReceiptReference | null;
  targetPreferences: unknown;
}

interface RuntimeBootstrap {
  installations: Array<{
    id: string;
    workspaces: Array<{
      id: string;
      moduleSurface: unknown;
      coreSurfaceState: unknown;
      coreSurfaceSelectionReceipt: unknown;
    }>;
  }>;
}

export interface WorkspaceCoreSurfaceSelectionCliDependencies {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  requestFetch?: typeof fetch;
  emit?: (value: unknown) => void;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function canonicalUuid(value: string, name: string): string {
  if (!uuidPattern.test(value)) {
    throw new Error(`${name} must be a canonical lowercase UUID`);
  }
  return value;
}

function prefixedSha256(value: string, name: string): string {
  if (!sha256Pattern.test(value)) {
    throw new Error(
      `${name} must be sha256: plus 64 lowercase hexadecimal characters`,
    );
  }
  return value;
}

function canonicalTimestamp(value: string, name: string): string {
  if (
    !timestampPattern.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${name} must be a canonical UTC millisecond timestamp`);
  }
  return value;
}

function exactObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const received = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    received.length !== expected.length ||
    received.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${name} has unexpected or missing fields`);
  }
}

class DuplicateJsonObjectKeyError extends Error {}

/**
 * Walk the JSON grammar before JSON.parse so duplicate object keys cannot be
 * erased by the platform parser. String tokens are decoded with JSON.parse,
 * which makes escaped and literal spellings of the same key collide.
 */
class JsonObjectKeyScanner {
  private index = 0;

  constructor(private readonly source: string) {}

  scan(): void {
    this.skipWhitespace();
    this.scanValue();
    this.skipWhitespace();
    if (this.index !== this.source.length)
      throw new SyntaxError("Invalid JSON");
  }

  private scanValue(): void {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === "{") {
      this.scanObject();
      return;
    }
    if (character === "[") {
      this.scanArray();
      return;
    }
    if (character === '"') {
      this.readString();
      return;
    }
    const start = this.index;
    while (
      this.index < this.source.length &&
      !/[\s,\]}]/.test(this.source[this.index]!)
    ) {
      this.index += 1;
    }
    if (this.index === start) throw new SyntaxError("Invalid JSON");
  }

  private scanObject(): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("}")) return;
    const keys = new Set<string>();
    while (true) {
      this.skipWhitespace();
      const key = this.readString();
      if (keys.has(key)) throw new DuplicateJsonObjectKeyError();
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      this.scanValue();
      this.skipWhitespace();
      if (this.consume("}")) return;
      this.expect(",");
    }
  }

  private scanArray(): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("]")) return;
    while (true) {
      this.scanValue();
      this.skipWhitespace();
      if (this.consume("]")) return;
      this.expect(",");
    }
  }

  private readString(): string {
    if (this.source[this.index] !== '"') throw new SyntaxError("Invalid JSON");
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === '"') {
        this.index += 1;
        const decoded = JSON.parse(
          this.source.slice(start, this.index),
        ) as unknown;
        if (typeof decoded !== "string") throw new SyntaxError("Invalid JSON");
        return decoded;
      }
      if (character === "\\") {
        this.index += 2;
      } else {
        if (character.charCodeAt(0) <= 0x1f)
          throw new SyntaxError("Invalid JSON");
        this.index += 1;
      }
    }
    throw new SyntaxError("Invalid JSON");
  }

  private skipWhitespace(): void {
    while (
      this.index < this.source.length &&
      /[\u0009\u000a\u000d\u0020]/.test(this.source[this.index]!)
    ) {
      this.index += 1;
    }
  }

  private consume(character: string): boolean {
    if (this.source[this.index] !== character) return false;
    this.index += 1;
    return true;
  }

  private expect(character: string): void {
    if (!this.consume(character)) throw new SyntaxError("Invalid JSON");
  }
}

function parseStrictJson(contents: string, name: string): unknown {
  try {
    new JsonObjectKeyScanner(contents).scan();
    return JSON.parse(contents) as unknown;
  } catch (error) {
    if (error instanceof DuplicateJsonObjectKeyError) {
      throw new Error(`${name} must not contain duplicate JSON object keys`);
    }
    throw new Error(`${name} must contain valid JSON`);
  }
}

async function readStrictJsonFile(
  path: string,
  name: string,
): Promise<unknown> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(`${name} must name an existing non-symlink JSON file`);
  }
  let contents: string;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error(`${name} must name a regular JSON file`);
    }
    if (metadata.size < 2 || metadata.size > maximumJsonBytes) {
      throw new Error(`${name} must contain 2 to ${maximumJsonBytes} bytes`);
    }
    contents = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
  return parseStrictJson(contents, name);
}

function readPredecessor(
  env: NodeJS.ProcessEnv,
): WorkspaceCoreSurfaceSelectionReceiptReference | null {
  const receiptId =
    env.VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_ID?.trim();
  const receiptSha256 =
    env.VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_SHA256?.trim();
  if (!receiptId && !receiptSha256) return null;
  if (!receiptId || !receiptSha256) {
    throw new Error(
      "Predecessor receipt ID and SHA-256 must be provided together",
    );
  }
  return {
    receiptId: canonicalUuid(
      receiptId,
      "VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_ID",
    ),
    receiptSha256: prefixedSha256(
      receiptSha256,
      "VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_SHA256",
    ),
  };
}

function parseSelectionReceiptReference(
  value: unknown,
  name: string,
): WorkspaceCoreSurfaceSelectionReceiptReference {
  const parsed =
    workspaceCoreSurfaceSelectionReceiptReferenceSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${name} is invalid`);
  return parsed.data;
}

export async function readWorkspaceCoreSurfaceSelectionPlanInput(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceCoreSurfaceSelectionPlanInput> {
  const currentSurfacePath = required(
    env,
    "VORTON_CORE_SURFACE_SELECTION_CURRENT_SURFACE_PATH",
  );
  const targetPreferencesPath = required(
    env,
    "VORTON_CORE_SURFACE_SELECTION_TARGET_PREFERENCES_PATH",
  );
  if (currentSurfacePath === targetPreferencesPath) {
    throw new Error(
      "Current surface and target preferences files must be distinct",
    );
  }
  return {
    vortonInstallationId: canonicalUuid(
      required(env, "VORTON_CORE_SURFACE_SELECTION_INSTALLATION_ID"),
      "VORTON_CORE_SURFACE_SELECTION_INSTALLATION_ID",
    ),
    workspaceId: canonicalUuid(
      required(env, "VORTON_CORE_SURFACE_SELECTION_WORKSPACE_ID"),
      "VORTON_CORE_SURFACE_SELECTION_WORKSPACE_ID",
    ),
    approvalId: canonicalUuid(
      required(env, "VORTON_CORE_SURFACE_SELECTION_APPROVAL_ID"),
      "VORTON_CORE_SURFACE_SELECTION_APPROVAL_ID",
    ),
    workId: canonicalUuid(
      required(env, "VORTON_CORE_SURFACE_SELECTION_WORK_ID"),
      "VORTON_CORE_SURFACE_SELECTION_WORK_ID",
    ),
    capabilityGrantId: canonicalUuid(
      required(env, "VORTON_CORE_SURFACE_SELECTION_CAPABILITY_GRANT_ID"),
      "VORTON_CORE_SURFACE_SELECTION_CAPABILITY_GRANT_ID",
    ),
    expiresAt: canonicalTimestamp(
      required(env, "VORTON_CORE_SURFACE_SELECTION_EXPIRES_AT"),
      "VORTON_CORE_SURFACE_SELECTION_EXPIRES_AT",
    ),
    currentSurface: await readStrictJsonFile(
      currentSurfacePath,
      "VORTON_CORE_SURFACE_SELECTION_CURRENT_SURFACE_PATH",
    ),
    predecessorCoreSurfaceSelectionReceipt: readPredecessor(env),
    targetPreferences: await readStrictJsonFile(
      targetPreferencesPath,
      "VORTON_CORE_SURFACE_SELECTION_TARGET_PREFERENCES_PATH",
    ),
  };
}

function projectPlanCore(
  value: WorkspaceCoreSurfaceSelectionPlan,
): WorkspaceCoreSurfaceSelectionPlanCore {
  const { planHash: _planHash, ...core } = value;
  return core;
}

export async function buildWorkspaceCoreSurfaceSelectionPlan(
  input: WorkspaceCoreSurfaceSelectionPlanInput,
): Promise<WorkspaceCoreSurfaceSelectionPlan> {
  const currentSurface = projectWorkspaceCoreSurface(input.currentSurface);
  const targetPreferences = workspaceCoreSurfacePreferencesSchema.parse(
    input.targetPreferences,
  );
  const targetSurface = deriveWorkspaceCoreSurface(targetPreferences);
  const currentSurfaceSha256 = await hashWorkspaceCoreSurface(currentSurface);
  const targetSurfaceSha256 = await hashWorkspaceCoreSurface(targetSurface);
  if (
    canonicalWorkspaceCoreSurfaceSelectionJson(currentSurface) ===
      canonicalWorkspaceCoreSurfaceSelectionJson(targetSurface) ||
    currentSurfaceSha256 === targetSurfaceSha256
  ) {
    throw new Error("Target surface must differ from the current surface");
  }
  if (
    currentSurface.modules.length > 0 &&
    input.predecessorCoreSurfaceSelectionReceipt === null
  ) {
    throw new Error(
      "A nonempty current surface requires its predecessor selection receipt",
    );
  }

  const approvalRequest =
    workspaceCoreSurfaceSelectionApprovalRequestSchema.parse({
      approvalId: canonicalUuid(input.approvalId, "approvalId"),
      workId: canonicalUuid(input.workId, "workId"),
      capabilityGrantId: canonicalUuid(
        input.capabilityGrantId,
        "capabilityGrantId",
      ),
      compiledRegistrySha256: workspaceCompiledCoreSurfaceRegistrySha256,
      expectedCurrentSurfaceSha256: currentSurfaceSha256,
      expectedPredecessorCoreSurfaceSelectionReceipt:
        input.predecessorCoreSurfaceSelectionReceipt,
      targetPreferences,
      expiresAt: canonicalTimestamp(input.expiresAt, "expiresAt"),
    });
  const core: WorkspaceCoreSurfaceSelectionPlanCore = {
    contract: workspaceCoreSurfaceSelectionPlanContract,
    operation: "select-workspace-core-surface",
    vortonInstallationId: canonicalUuid(
      input.vortonInstallationId,
      "vortonInstallationId",
    ),
    workspaceId: canonicalUuid(input.workspaceId, "workspaceId"),
    approval: {
      approvalId: approvalRequest.approvalId,
      workId: approvalRequest.workId,
      capabilityGrantId: approvalRequest.capabilityGrantId,
      expiresAt: approvalRequest.expiresAt,
    },
    transition: {
      currentSurface,
      currentSurfaceSha256,
      compiledRegistrySha256: workspaceCompiledCoreSurfaceRegistrySha256,
      predecessorCoreSurfaceSelectionReceipt:
        approvalRequest.expectedPredecessorCoreSurfaceSelectionReceipt,
      targetPreferences: approvalRequest.targetPreferences,
      targetSurface,
      targetSurfaceSha256,
    },
    scope: {
      compiledCoreSurfaceOnly: true,
      moduleReleaseAdmission: false,
      infrastructureMutation: false,
      otherWorkspaceMutation: false,
    },
    rollback: {
      separateApprovalRequired: true,
      ungatedRollbackCommand: false,
    },
  };
  return {
    ...core,
    planHash: await workspaceCoreSurfaceSelectionCanonicalPlanSha256(core),
  };
}

export async function workspaceCoreSurfaceSelectionCanonicalPlanSha256(
  value: WorkspaceCoreSurfaceSelectionPlanCore,
): Promise<string> {
  return workspaceCoreSurfaceSelectionCanonicalSha256(value);
}

export async function parseWorkspaceCoreSurfaceSelectionPlan(
  value: unknown,
): Promise<WorkspaceCoreSurfaceSelectionPlan> {
  const candidate = exactObject(value, "Selection plan");
  exactKeys(
    candidate,
    [
      "contract",
      "operation",
      "vortonInstallationId",
      "workspaceId",
      "approval",
      "transition",
      "scope",
      "rollback",
      "planHash",
    ],
    "Selection plan",
  );
  const approval = exactObject(candidate.approval, "Selection plan approval");
  exactKeys(
    approval,
    ["approvalId", "workId", "capabilityGrantId", "expiresAt"],
    "Selection plan approval",
  );
  const transition = exactObject(
    candidate.transition,
    "Selection plan transition",
  );
  exactKeys(
    transition,
    [
      "currentSurface",
      "currentSurfaceSha256",
      "compiledRegistrySha256",
      "predecessorCoreSurfaceSelectionReceipt",
      "targetPreferences",
      "targetSurface",
      "targetSurfaceSha256",
    ],
    "Selection plan transition",
  );
  const scope = exactObject(candidate.scope, "Selection plan scope");
  exactKeys(
    scope,
    [
      "compiledCoreSurfaceOnly",
      "moduleReleaseAdmission",
      "infrastructureMutation",
      "otherWorkspaceMutation",
    ],
    "Selection plan scope",
  );
  const rollback = exactObject(candidate.rollback, "Selection plan rollback");
  exactKeys(
    rollback,
    ["separateApprovalRequired", "ungatedRollbackCommand"],
    "Selection plan rollback",
  );
  let predecessorCoreSurfaceSelectionReceipt: WorkspaceCoreSurfaceSelectionReceiptReference | null =
    null;
  if (transition.predecessorCoreSurfaceSelectionReceipt !== null) {
    const predecessor = exactObject(
      transition.predecessorCoreSurfaceSelectionReceipt,
      "Selection plan predecessor",
    );
    exactKeys(
      predecessor,
      ["receiptId", "receiptSha256"],
      "Selection plan predecessor",
    );
    predecessorCoreSurfaceSelectionReceipt = {
      receiptId: canonicalUuid(
        String(predecessor.receiptId),
        "plan.transition.predecessorCoreSurfaceSelectionReceipt.receiptId",
      ),
      receiptSha256: prefixedSha256(
        String(predecessor.receiptSha256),
        "plan.transition.predecessorCoreSurfaceSelectionReceipt.receiptSha256",
      ),
    };
  }
  const rebuilt = await buildWorkspaceCoreSurfaceSelectionPlan({
    vortonInstallationId: canonicalUuid(
      String(candidate.vortonInstallationId),
      "plan.vortonInstallationId",
    ),
    workspaceId: canonicalUuid(
      String(candidate.workspaceId),
      "plan.workspaceId",
    ),
    approvalId: canonicalUuid(
      String(approval.approvalId),
      "plan.approval.approvalId",
    ),
    workId: canonicalUuid(String(approval.workId), "plan.approval.workId"),
    capabilityGrantId: canonicalUuid(
      String(approval.capabilityGrantId),
      "plan.approval.capabilityGrantId",
    ),
    expiresAt: canonicalTimestamp(
      String(approval.expiresAt),
      "plan.approval.expiresAt",
    ),
    currentSurface: transition.currentSurface,
    predecessorCoreSurfaceSelectionReceipt,
    targetPreferences: transition.targetPreferences,
  });
  if (
    candidate.contract !== workspaceCoreSurfaceSelectionPlanContract ||
    candidate.operation !== "select-workspace-core-surface" ||
    transition.currentSurfaceSha256 !==
      rebuilt.transition.currentSurfaceSha256 ||
    transition.compiledRegistrySha256 !==
      rebuilt.transition.compiledRegistrySha256 ||
    transition.targetSurfaceSha256 !== rebuilt.transition.targetSurfaceSha256 ||
    canonicalWorkspaceCoreSurfaceSelectionJson(transition.targetSurface) !==
      canonicalWorkspaceCoreSurfaceSelectionJson(
        rebuilt.transition.targetSurface,
      ) ||
    scope.compiledCoreSurfaceOnly !== true ||
    scope.moduleReleaseAdmission !== false ||
    scope.infrastructureMutation !== false ||
    scope.otherWorkspaceMutation !== false ||
    rollback.separateApprovalRequired !== true ||
    rollback.ungatedRollbackCommand !== false ||
    candidate.planHash !== rebuilt.planHash
  ) {
    throw new Error("Selection plan content or canonical hash is invalid");
  }
  return rebuilt;
}

async function readPlan(
  env: NodeJS.ProcessEnv,
): Promise<WorkspaceCoreSurfaceSelectionPlan> {
  return parseWorkspaceCoreSurfaceSelectionPlan(
    await readStrictJsonFile(
      required(env, "VORTON_CORE_SURFACE_SELECTION_PLAN_PATH"),
      "VORTON_CORE_SURFACE_SELECTION_PLAN_PATH",
    ),
  );
}

function apiBaseUrl(env: NodeJS.ProcessEnv): string {
  const raw = required(env, "VORTON_CORE_SURFACE_SELECTION_API_URL");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "VORTON_CORE_SURFACE_SELECTION_API_URL must be an absolute URL",
    );
  }
  const localHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  if (
    (parsed.protocol !== "https:" && !localHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error(
      "VORTON_CORE_SURFACE_SELECTION_API_URL must be an HTTPS origin or local HTTP origin",
    );
  }
  return parsed.origin;
}

function bearerToken(env: NodeJS.ProcessEnv): string {
  const token = required(env, "VORTON_CORE_SURFACE_SELECTION_BEARER_TOKEN");
  if (!/^[A-Za-z0-9._~-]+$/.test(token)) {
    throw new Error(
      "VORTON_CORE_SURFACE_SELECTION_BEARER_TOKEN has an invalid bearer-token shape",
    );
  }
  return token;
}

function approvalRequest(plan: WorkspaceCoreSurfaceSelectionPlan) {
  return workspaceCoreSurfaceSelectionApprovalRequestSchema.parse({
    approvalId: plan.approval.approvalId,
    workId: plan.approval.workId,
    capabilityGrantId: plan.approval.capabilityGrantId,
    compiledRegistrySha256: plan.transition.compiledRegistrySha256,
    expectedCurrentSurfaceSha256: plan.transition.currentSurfaceSha256,
    expectedPredecessorCoreSurfaceSelectionReceipt:
      plan.transition.predecessorCoreSurfaceSelectionReceipt,
    targetPreferences: plan.transition.targetPreferences,
    expiresAt: plan.approval.expiresAt,
  });
}

async function requestJson(
  requestFetch: typeof fetch,
  operation: string,
  url: string,
  token: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await requestFetch(url, {
      ...init,
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  } catch {
    throw new Error(`Vorton API ${operation} request failed before response`);
  }
  if (!response.ok) {
    throw new Error(
      `Vorton API ${operation} request failed with HTTP ${response.status}`,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error(`Vorton API ${operation} returned invalid JSON`);
  }
}

function assertCreationMatchesPlan(
  creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
  plan: WorkspaceCoreSurfaceSelectionPlan,
): void {
  const approval = creation.approval;
  if (
    approval.approvalId !== plan.approval.approvalId ||
    approval.binding.vortonInstallationId !== plan.vortonInstallationId ||
    approval.binding.workspaceId !== plan.workspaceId ||
    approval.binding.workId !== plan.approval.workId ||
    approval.authority.capabilityGrantId !== plan.approval.capabilityGrantId ||
    approval.expiresAt !== plan.approval.expiresAt ||
    approval.binding.currentSurfaceSha256 !==
      plan.transition.currentSurfaceSha256 ||
    approval.binding.compiledRegistrySha256 !==
      plan.transition.compiledRegistrySha256 ||
    approval.binding.targetSurfaceSha256 !==
      plan.transition.targetSurfaceSha256 ||
    canonicalWorkspaceCoreSurfaceSelectionJson(
      approval.binding.predecessorCoreSurfaceSelectionReceipt,
    ) !==
      canonicalWorkspaceCoreSurfaceSelectionJson(
        plan.transition.predecessorCoreSurfaceSelectionReceipt,
      ) ||
    canonicalWorkspaceCoreSurfaceSelectionJson(
      approval.binding.targetPreferences,
    ) !==
      canonicalWorkspaceCoreSurfaceSelectionJson(
        plan.transition.targetPreferences,
      ) ||
    canonicalWorkspaceCoreSurfaceSelectionJson(
      approval.binding.currentSurface,
    ) !==
      canonicalWorkspaceCoreSurfaceSelectionJson(
        plan.transition.currentSurface,
      ) ||
    canonicalWorkspaceCoreSurfaceSelectionJson(
      approval.binding.targetSurface,
    ) !==
      canonicalWorkspaceCoreSurfaceSelectionJson(plan.transition.targetSurface)
  ) {
    throw new Error("API approval does not match the exact selection plan");
  }
}

export async function approveWorkspaceCoreSurfaceSelection(
  plan: WorkspaceCoreSurfaceSelectionPlan,
  env: NodeJS.ProcessEnv = process.env,
  requestFetch: typeof fetch = fetch,
): Promise<WorkspaceCoreSurfaceSelectionApprovalCreation> {
  const value = await requestJson(
    requestFetch,
    "approval",
    `${apiBaseUrl(env)}/v1/installations/${plan.vortonInstallationId}/workspaces/${plan.workspaceId}/core-surface-selection-approvals`,
    bearerToken(env),
    { method: "POST", body: JSON.stringify(approvalRequest(plan)) },
  );
  let creation: WorkspaceCoreSurfaceSelectionApprovalCreation;
  try {
    creation = await parseWorkspaceCoreSurfaceSelectionApprovalCreation(value);
  } catch {
    throw new Error("Vorton API approval response failed contract validation");
  }
  assertCreationMatchesPlan(creation, plan);
  return creation;
}

export async function applyWorkspaceCoreSurfaceSelection(
  plan: WorkspaceCoreSurfaceSelectionPlan,
  creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
  receiptId: string,
  env: NodeJS.ProcessEnv = process.env,
  requestFetch: typeof fetch = fetch,
): Promise<WorkspaceCoreSurfaceSelectionReceipt> {
  const parsedCreation =
    await parseWorkspaceCoreSurfaceSelectionApprovalCreation(creation);
  assertCreationMatchesPlan(parsedCreation, plan);
  const exactReceiptId = canonicalUuid(
    receiptId,
    "VORTON_CORE_SURFACE_SELECTION_RECEIPT_ID",
  );
  const value = exactObject(
    await requestJson(
      requestFetch,
      "application",
      `${apiBaseUrl(env)}/v1/installations/${plan.vortonInstallationId}/workspaces/${plan.workspaceId}/core-surface-selection-approvals/${plan.approval.approvalId}/execute`,
      bearerToken(env),
      { method: "POST", body: JSON.stringify({ receiptId: exactReceiptId }) },
    ),
    "Selection application response",
  );
  let returnedCreation: WorkspaceCoreSurfaceSelectionApprovalCreation;
  try {
    returnedCreation = await parseWorkspaceCoreSurfaceSelectionApprovalCreation(
      {
        approval: value.approval,
        approvalReceipt: value.approvalReceipt,
      },
    );
  } catch {
    throw new Error(
      "Vorton API application response failed approval contract validation",
    );
  }
  assertCreationMatchesPlan(returnedCreation, plan);
  if (
    canonicalWorkspaceCoreSurfaceSelectionJson(returnedCreation) !==
    canonicalWorkspaceCoreSurfaceSelectionJson(parsedCreation)
  ) {
    throw new Error("API application returned a different approval authority");
  }
  let receipt: WorkspaceCoreSurfaceSelectionReceipt;
  try {
    receipt = await parseWorkspaceCoreSurfaceSelectionReceipt(
      value.receipt,
      returnedCreation,
    );
  } catch {
    throw new Error(
      "Vorton API application receipt failed contract validation",
    );
  }
  if (
    receipt.receiptId !== exactReceiptId ||
    canonicalWorkspaceCoreSurfaceSelectionJson(receipt.postimageSurface) !==
      canonicalWorkspaceCoreSurfaceSelectionJson(
        plan.transition.targetSurface,
      ) ||
    receipt.postimageSurfaceSha256 !== plan.transition.targetSurfaceSha256
  ) {
    throw new Error("API receipt does not match the exact selection plan");
  }
  return receipt;
}

function parseBootstrap(value: unknown): RuntimeBootstrap {
  const root = exactObject(value, "Runtime bootstrap");
  if (!Array.isArray(root.installations)) {
    throw new Error("Runtime bootstrap installations are invalid");
  }
  for (const installationValue of root.installations) {
    const installation = exactObject(
      installationValue,
      "Runtime bootstrap installation",
    );
    if (
      typeof installation.id !== "string" ||
      !Array.isArray(installation.workspaces)
    ) {
      throw new Error("Runtime bootstrap installation is invalid");
    }
    for (const workspaceValue of installation.workspaces) {
      const workspace = exactObject(
        workspaceValue,
        "Runtime bootstrap workspace",
      );
      if (
        typeof workspace.id !== "string" ||
        !("moduleSurface" in workspace) ||
        !("coreSurfaceState" in workspace) ||
        !("coreSurfaceSelectionReceipt" in workspace)
      ) {
        throw new Error("Runtime bootstrap workspace is invalid");
      }
    }
  }
  return value as RuntimeBootstrap;
}

export async function verifyWorkspaceCoreSurfaceSelection(
  plan: WorkspaceCoreSurfaceSelectionPlan,
  creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
  applicationReceipt: WorkspaceCoreSurfaceSelectionReceipt,
  env: NodeJS.ProcessEnv = process.env,
  requestFetch: typeof fetch = fetch,
): Promise<{
  contract: "vorton.select-workspace-core-surface-verification.v1";
  planHash: string;
  vortonInstallationId: string;
  workspaceId: string;
  targetSurfaceSha256: string;
  selectionReceipt: WorkspaceCoreSurfaceSelectionReceiptReference;
  verified: true;
}> {
  const parsedCreation =
    await parseWorkspaceCoreSurfaceSelectionApprovalCreation(creation);
  assertCreationMatchesPlan(parsedCreation, plan);
  const receipt = await parseWorkspaceCoreSurfaceSelectionReceipt(
    applicationReceipt,
    parsedCreation,
  );
  if (
    canonicalWorkspaceCoreSurfaceSelectionJson(receipt.postimageSurface) !==
      canonicalWorkspaceCoreSurfaceSelectionJson(
        plan.transition.targetSurface,
      ) ||
    receipt.postimageSurfaceSha256 !== plan.transition.targetSurfaceSha256
  ) {
    throw new Error(
      "Application receipt does not match the exact selection plan",
    );
  }
  const bootstrap = parseBootstrap(
    await requestJson(
      requestFetch,
      "verification",
      `${apiBaseUrl(env)}/v1/runtime/bootstrap`,
      bearerToken(env),
      { method: "GET" },
    ),
  );
  const matchingInstallations = bootstrap.installations.filter(
    (candidate) => candidate.id === plan.vortonInstallationId,
  );
  if (matchingInstallations.length !== 1) {
    throw new Error(
      "Runtime bootstrap must contain exactly one planned installation",
    );
  }
  const matchingWorkspaces = matchingInstallations[0]!.workspaces.filter(
    (candidate) => candidate.id === plan.workspaceId,
  );
  if (matchingWorkspaces.length !== 1) {
    throw new Error(
      "Runtime bootstrap must contain exactly one planned workspace",
    );
  }
  const workspace = matchingWorkspaces[0]!;
  if (workspace.coreSurfaceState !== "selected") {
    throw new Error(
      "Runtime bootstrap does not expose a selected core surface",
    );
  }
  const head = parseSelectionReceiptReference(
    workspace.coreSurfaceSelectionReceipt,
    "Runtime bootstrap selection receipt",
  );
  if (
    head.receiptId !== receipt.receiptId ||
    head.receiptSha256 !== receipt.receiptHash
  ) {
    throw new Error(
      "Runtime bootstrap does not expose the exact application receipt as its current head",
    );
  }
  const actual = projectWorkspaceCoreSurface(workspace.moduleSurface);
  const actualHash = await hashWorkspaceCoreSurface(actual);
  if (
    actualHash !== plan.transition.targetSurfaceSha256 ||
    canonicalWorkspaceCoreSurfaceSelectionJson(actual) !==
      canonicalWorkspaceCoreSurfaceSelectionJson(plan.transition.targetSurface)
  ) {
    throw new Error(
      "Runtime bootstrap does not expose the exact target surface",
    );
  }
  return {
    contract: "vorton.select-workspace-core-surface-verification.v1",
    planHash: plan.planHash,
    vortonInstallationId: plan.vortonInstallationId,
    workspaceId: plan.workspaceId,
    targetSurfaceSha256: actualHash,
    selectionReceipt: head,
    verified: true,
  };
}

function exactMode(argv: string[]): "plan" | "approve" | "apply" | "verify" {
  if (argv.length !== 1) {
    throw new Error(
      "Choose exactly one mode: --plan, --approve, --apply, or --verify",
    );
  }
  switch (argv[0]) {
    case "--plan":
      return "plan";
    case "--approve":
      return "approve";
    case "--apply":
      return "apply";
    case "--verify":
      return "verify";
    default:
      throw new Error(
        "Choose exactly one mode: --plan, --approve, --apply, or --verify",
      );
  }
}

export async function runWorkspaceCoreSurfaceSelectionCli(
  dependencies: WorkspaceCoreSurfaceSelectionCliDependencies = {},
): Promise<unknown> {
  const argv = dependencies.argv ?? process.argv.slice(2);
  const env = dependencies.env ?? process.env;
  const requestFetch = dependencies.requestFetch ?? fetch;
  const emit =
    dependencies.emit ??
    ((value) => console.log(JSON.stringify(value, null, 2)));
  const mode = exactMode(argv);
  let result: unknown;
  if (mode === "plan") {
    result = await buildWorkspaceCoreSurfaceSelectionPlan(
      await readWorkspaceCoreSurfaceSelectionPlanInput(env),
    );
  } else {
    const plan = await readPlan(env);
    if (mode === "approve") {
      result = await approveWorkspaceCoreSurfaceSelection(
        plan,
        env,
        requestFetch,
      );
    } else if (mode === "apply") {
      const creation = await parseWorkspaceCoreSurfaceSelectionApprovalCreation(
        await readStrictJsonFile(
          required(env, "VORTON_CORE_SURFACE_SELECTION_APPROVAL_PATH"),
          "VORTON_CORE_SURFACE_SELECTION_APPROVAL_PATH",
        ),
      );
      result = await applyWorkspaceCoreSurfaceSelection(
        plan,
        creation,
        required(env, "VORTON_CORE_SURFACE_SELECTION_RECEIPT_ID"),
        env,
        requestFetch,
      );
    } else {
      const creation = await parseWorkspaceCoreSurfaceSelectionApprovalCreation(
        await readStrictJsonFile(
          required(env, "VORTON_CORE_SURFACE_SELECTION_APPROVAL_PATH"),
          "VORTON_CORE_SURFACE_SELECTION_APPROVAL_PATH",
        ),
      );
      const receipt = await parseWorkspaceCoreSurfaceSelectionReceipt(
        await readStrictJsonFile(
          required(env, "VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH"),
          "VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH",
        ),
        creation,
      );
      result = await verifyWorkspaceCoreSurfaceSelection(
        plan,
        creation,
        receipt,
        env,
        requestFetch,
      );
    }
  }
  emit(result);
  return result;
}

if (
  process.argv[1]?.endsWith(
    "deploy/core-surfaces/select-workspace-core-surface.ts",
  )
) {
  runWorkspaceCoreSurfaceSelectionCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown failure";
    console.error(message);
    process.exitCode = 1;
  });
}
