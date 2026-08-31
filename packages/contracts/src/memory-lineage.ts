import { z } from "zod";

import { moduleLifecycleCanonicalSha256 } from "./module-lifecycle.js";

const canonicalUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sourceCommit = z.string().regex(/^[a-f0-9]{40}$/);
const safeCount = z.number().int().safe().nonnegative();
const realmSchema = z.enum(["personal", "organizational"]);
const utcMilliseconds = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .datetime()
  .refine(
    (value) => new Date(value).toISOString() === value,
    "must be a canonical UTC millisecond timestamp",
  );

const dispositionSchema = z.enum(["rebuild", "quarantine", "discard"]);
const legacyFamilySchema = z.literal("installation-default-lineage-v1");

export const hindsightLegacyBankInventoryEntrySchema = z
  .object({
    externalBankIdSha256: sha256,
    inventoryEvidenceSha256: sha256,
    legacyFamily: legacyFamilySchema,
    validFactCount: safeCount,
    invalidatedFactCount: safeCount,
    factCount: safeCount,
    observationCount: safeCount,
    pendingConsolidationCount: safeCount,
    failedConsolidationCount: safeCount,
    canonicalSourceCoveredFactCount: safeCount,
    canonicalSourceUncoveredFactCount: safeCount,
    disposition: dispositionSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      BigInt(entry.validFactCount) + BigInt(entry.invalidatedFactCount) !==
      BigInt(entry.factCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["factCount"],
        message: "Valid and invalidated facts must equal the exact fact count",
      });
    }
    if (
      BigInt(entry.canonicalSourceCoveredFactCount) +
        BigInt(entry.canonicalSourceUncoveredFactCount) !==
      BigInt(entry.factCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonicalSourceCoveredFactCount"],
        message: "Canonical source coverage must equal the exact fact count",
      });
    }
    if (
      (entry.disposition === "rebuild" || entry.disposition === "discard") &&
      entry.canonicalSourceUncoveredFactCount !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonicalSourceUncoveredFactCount"],
        message:
          "Rebuild and discard require canonical source coverage for every fact",
      });
    }
    if (
      entry.disposition === "rebuild" &&
      entry.pendingConsolidationCount !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["pendingConsolidationCount"],
        message: "Rebuild requires zero pending consolidation",
      });
    }
    if (
      entry.disposition === "discard" &&
      (entry.pendingConsolidationCount !== 0 ||
        entry.failedConsolidationCount !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["pendingConsolidationCount"],
        message: "Discard requires zero pending and failed consolidation",
      });
    }
    if (
      BigInt(entry.pendingConsolidationCount) +
        BigInt(entry.failedConsolidationCount) >
      BigInt(entry.validFactCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["pendingConsolidationCount"],
        message:
          "Pending and failed consolidation cannot exceed valid source facts",
      });
    }
  });

const aggregateTotalsSchema = z
  .object({
    bankCount: safeCount,
    validFactCount: safeCount,
    invalidatedFactCount: safeCount,
    factCount: safeCount,
    observationCount: safeCount,
    pendingConsolidationCount: safeCount,
    failedConsolidationCount: safeCount,
    canonicalSourceCoveredFactCount: safeCount,
    canonicalSourceUncoveredFactCount: safeCount,
  })
  .strict();

const dispositionCountsSchema = z
  .object({
    rebuild: safeCount,
    quarantine: safeCount,
    discard: safeCount,
    total: safeCount,
  })
  .strict();

const scopeSchema = z
  .object({
    vortonInstallationId: canonicalUuid,
    workspaceId: canonicalUuid,
    realm: realmSchema,
    assignment: z
      .object({
        mode: z.literal("explicit"),
        evidenceSha256: sha256,
        workspaceInferred: z.literal(false),
      })
      .strict(),
  })
  .strict();

const targetSchema = z
  .object({
    adapter: z.literal("hindsight"),
    externalBankId: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[\x20-\x7e]+$/),
    lineage: z.literal("lineage-v2"),
    requiredState: z.literal("absent"),
    freshness: z
      .object({
        evidenceSha256: sha256,
        observedAt: utcMilliseconds,
        maximumAgeSeconds: z.literal(600),
        reportedCounts: z
          .object({
            banks: z.literal(0),
            facts: z.literal(0),
            observations: z.literal(0),
            consolidations: z.literal(0),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const canonicalSourcesSchema = z
  .object({
    sourceRevisionCount: safeCount,
    citationCount: safeCount,
    sourceRevisionEvidenceSha256: sha256,
    citationEvidenceSha256: sha256,
  })
  .strict();

const transferPolicySchema = z
  .object({
    copyProviderDerivedState: z.literal(false),
    copyProviderFacts: z.literal(false),
    copyProviderObservations: z.literal(false),
    copyProviderConsolidations: z.literal(false),
    rebuildFromCanonicalVortonSourcesOnly: z.literal(true),
  })
  .strict();

const evidencePolicySchema = z
  .object({
    suppliedDigestsAndCountsOnly: z.literal(true),
    liveInspectionPerformed: z.literal(false),
    rawExternalBankIdsIncluded: z.literal(false),
    rawMemoryContentIncluded: z.literal(false),
    personalRecordsIncluded: z.literal(false),
  })
  .strict();

const authoritySchema = z
  .object({
    planOnly: z.literal(true),
    grantsAuthority: z.literal(false),
    separateApprovalRequired: z.literal(true),
    liveWorkspaceMembershipRequired: z.literal(true),
    recentAal2Required: z.literal(true),
    rolesGrantAuthority: z.literal(false),
    workspaceMembershipChecked: z.literal(false),
    aal2Checked: z.literal(false),
    approvalCreated: z.literal(false),
    executionAuthorized: z.literal(false),
    migrationAuthorized: z.literal(false),
    retirementAuthorized: z.literal(false),
    providerReadAuthorized: z.literal(false),
    providerWriteAuthorized: z.literal(false),
    postgresMutationAuthorized: z.literal(false),
    targetActivationAuthorized: z.literal(false),
    targetAbsenceRecheckRequired: z.literal(true),
    externalMutationAuthorized: z.literal(false),
  })
  .strict();

const effectsSchema = z
  .object({
    providerReadPerformed: z.literal(false),
    providerWritePerformed: z.literal(false),
    postgresWritePerformed: z.literal(false),
    targetCreated: z.literal(false),
    legacyBankMutated: z.literal(false),
    personalDataRead: z.literal(false),
    authorityCreated: z.literal(false),
    receiptCreated: z.literal(false),
  })
  .strict();

const planCoreShape = {
  contract: z.literal("vorton.hindsight-legacy-bank-disposition-plan.v1"),
  sourceCommit,
  scope: scopeSchema,
  target: targetSchema,
  inventoryEvidenceBundleSha256: sha256,
  inventoryEvidenceObservedAt: utcMilliseconds,
  inventoryMaximumAgeSeconds: z.literal(600),
  legacyInventory: z.array(hindsightLegacyBankInventoryEntrySchema).max(1),
  aggregateTotals: aggregateTotalsSchema,
  dispositionCounts: dispositionCountsSchema,
  canonicalSources: canonicalSourcesSchema,
  transferPolicy: transferPolicySchema,
  evidencePolicy: evidencePolicySchema,
  authority: authoritySchema,
  effects: effectsSchema,
  plannedAt: utcMilliseconds,
  expiresAt: utcMilliseconds,
} as const;

function canonicalTarget(scope: z.infer<typeof scopeSchema>): string {
  return `${scope.realm}:${scope.vortonInstallationId}:${scope.workspaceId}:lineage-v2`;
}

function canonicalLegacyV1Bank(scope: z.infer<typeof scopeSchema>): string {
  return `${scope.realm}:${scope.vortonInstallationId}:default`;
}

/** SHA-256 over the exact UTF-8 bytes of one Hindsight external bank ID. */
export async function hashHindsightExternalBankId(
  externalBankId: string,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(externalBankId),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function sortedUnique(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}

function sumCounts(values: readonly number[]): number | null {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

function aggregateInventory(
  inventory: readonly HindsightLegacyBankInventoryEntry[],
): HindsightLegacyBankAggregateTotals | null {
  const sum = (
    key: Exclude<keyof HindsightLegacyBankAggregateTotals, "bankCount">,
  ) => sumCounts(inventory.map((entry) => entry[key]));
  const totals = {
    bankCount: inventory.length,
    validFactCount: sum("validFactCount"),
    invalidatedFactCount: sum("invalidatedFactCount"),
    factCount: sum("factCount"),
    observationCount: sum("observationCount"),
    pendingConsolidationCount: sum("pendingConsolidationCount"),
    failedConsolidationCount: sum("failedConsolidationCount"),
    canonicalSourceCoveredFactCount: sum("canonicalSourceCoveredFactCount"),
    canonicalSourceUncoveredFactCount: sum("canonicalSourceUncoveredFactCount"),
  };
  return Object.values(totals).some((value) => value === null)
    ? null
    : (totals as HindsightLegacyBankAggregateTotals);
}

function countDispositions(
  inventory: readonly HindsightLegacyBankInventoryEntry[],
): HindsightLegacyBankDispositionCounts {
  return {
    rebuild: inventory.filter((entry) => entry.disposition === "rebuild")
      .length,
    quarantine: inventory.filter((entry) => entry.disposition === "quarantine")
      .length,
    discard: inventory.filter((entry) => entry.disposition === "discard")
      .length,
    total: inventory.length,
  };
}

function validatePlanCore(
  plan: z.infer<z.ZodObject<typeof planCoreShape>>,
  context: z.RefinementCtx,
): void {
  const identityDigests = plan.legacyInventory.map(
    (entry) => entry.externalBankIdSha256,
  );
  const inventoryEvidenceDigests = plan.legacyInventory.map(
    (entry) => entry.inventoryEvidenceSha256,
  );
  if (!sortedUnique(identityDigests)) {
    context.addIssue({
      code: "custom",
      path: ["legacyInventory"],
      message: "Legacy bank identity digests must be unique and sorted",
    });
  }
  if (plan.target.externalBankId !== canonicalTarget(plan.scope)) {
    context.addIssue({
      code: "custom",
      path: ["target", "externalBankId"],
      message: "Target must be the exact workspace lineage-v2 bank",
    });
  }
  const plannedAt = Date.parse(plan.plannedAt);
  const expiresAt = Date.parse(plan.expiresAt);
  const observedAt = Date.parse(plan.target.freshness.observedAt);
  const inventoryObservedAt = Date.parse(plan.inventoryEvidenceObservedAt);
  if (expiresAt <= plannedAt || expiresAt > plannedAt + 600 * 1_000) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "Disposition plan expiry must be within 600 seconds",
    });
  }
  if (observedAt > plannedAt || plannedAt - observedAt > 600 * 1_000) {
    context.addIssue({
      code: "custom",
      path: ["target", "freshness", "observedAt"],
      message: "Target freshness evidence must be no more than 600 seconds old",
    });
  }
  if (
    inventoryObservedAt > plannedAt ||
    plannedAt - inventoryObservedAt > 600 * 1_000
  ) {
    context.addIssue({
      code: "custom",
      path: ["inventoryEvidenceObservedAt"],
      message: "Legacy inventory evidence must be no more than 600 seconds old",
    });
  }
  if (
    expiresAt > observedAt + 600 * 1_000 ||
    expiresAt > inventoryObservedAt + 600 * 1_000
  ) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message:
        "Disposition plan cannot outlive its supplied freshness evidence",
    });
  }
  const expectedTotals = aggregateInventory(plan.legacyInventory);
  if (
    expectedTotals === null ||
    JSON.stringify(expectedTotals) !== JSON.stringify(plan.aggregateTotals)
  ) {
    context.addIssue({
      code: "custom",
      path: ["aggregateTotals"],
      message: "Aggregate totals must exactly match the legacy inventory",
    });
  }
  if (
    JSON.stringify(countDispositions(plan.legacyInventory)) !==
    JSON.stringify(plan.dispositionCounts)
  ) {
    context.addIssue({
      code: "custom",
      path: ["dispositionCounts"],
      message: "Disposition counts must exactly match the legacy inventory",
    });
  }
  const roleDigests = [
    plan.scope.assignment.evidenceSha256,
    plan.target.freshness.evidenceSha256,
    plan.inventoryEvidenceBundleSha256,
    plan.canonicalSources.sourceRevisionEvidenceSha256,
    plan.canonicalSources.citationEvidenceSha256,
  ];
  const evidenceDigests = [...inventoryEvidenceDigests, ...roleDigests];
  if (new Set(evidenceDigests).size !== evidenceDigests.length) {
    context.addIssue({
      code: "custom",
      path: ["canonicalSources"],
      message:
        "Inventory and top-level evidence roles require distinct digests",
    });
  }
  if (
    identityDigests.some((identityDigest) =>
      evidenceDigests.includes(identityDigest),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["legacyInventory"],
      message: "Bank identity and evidence digest roles must be distinct",
    });
  }
  if (
    plan.legacyInventory.some(
      (entry) =>
        (entry.disposition === "rebuild" || entry.disposition === "discard") &&
        entry.factCount > 0,
    ) &&
    (plan.canonicalSources.sourceRevisionCount === 0 ||
      plan.canonicalSources.citationCount === 0)
  ) {
    context.addIssue({
      code: "custom",
      path: ["canonicalSources"],
      message:
        "Fact-bearing rebuild and discard require canonical source revisions and citations",
    });
  }
}

export const hindsightLegacyBankDispositionPlanCoreSchema = z
  .object(planCoreShape)
  .strict()
  .superRefine(validatePlanCore);

export const hindsightLegacyBankDispositionPlanSchema = z
  .object({
    ...planCoreShape,
    planHash: sha256,
  })
  .strict()
  .superRefine(validatePlanCore);

// These schemas validate document structure and arithmetic. Authoritative
// consumers must use parseHindsightLegacyBankDispositionPlan so the derived
// legacy-bank identity, caller scope, and content address are also verified.

export type HindsightLegacyBankInventoryEntry = z.infer<
  typeof hindsightLegacyBankInventoryEntrySchema
>;
export type HindsightLegacyBankAggregateTotals = z.infer<
  typeof aggregateTotalsSchema
>;
export type HindsightLegacyBankDispositionCounts = z.infer<
  typeof dispositionCountsSchema
>;
export type HindsightLegacyBankDispositionPlanCore = z.infer<
  typeof hindsightLegacyBankDispositionPlanCoreSchema
>;
export type HindsightLegacyBankDispositionPlan = z.infer<
  typeof hindsightLegacyBankDispositionPlanSchema
>;

export type CreateHindsightLegacyBankDispositionPlanInput = Omit<
  HindsightLegacyBankDispositionPlanCore,
  "contract" | "legacyInventory" | "aggregateTotals" | "dispositionCounts"
> & {
  legacyInventory: HindsightLegacyBankInventoryEntry[];
};

export function projectHindsightLegacyBankDispositionPlanCore(
  value: unknown,
): HindsightLegacyBankDispositionPlanCore {
  const plan = hindsightLegacyBankDispositionPlanSchema.parse(value);
  const { planHash: _planHash, ...core } = plan;
  return hindsightLegacyBankDispositionPlanCoreSchema.parse(core);
}

export async function hashHindsightLegacyBankDispositionPlanCore(
  value: unknown,
): Promise<string> {
  const core = hindsightLegacyBankDispositionPlanCoreSchema.safeParse(value);
  return moduleLifecycleCanonicalSha256(
    core.success
      ? core.data
      : projectHindsightLegacyBankDispositionPlanCore(value),
  );
}

export async function createHindsightLegacyBankDispositionPlan(
  input: CreateHindsightLegacyBankDispositionPlanInput,
): Promise<HindsightLegacyBankDispositionPlan> {
  const legacyInventory = [...input.legacyInventory].sort((left, right) =>
    left.externalBankIdSha256 < right.externalBankIdSha256
      ? -1
      : left.externalBankIdSha256 > right.externalBankIdSha256
        ? 1
        : 0,
  );
  const aggregateTotals = aggregateInventory(legacyInventory);
  if (aggregateTotals === null) {
    throw new Error("Legacy inventory aggregate exceeds safe integer range");
  }
  const core = hindsightLegacyBankDispositionPlanCoreSchema.parse({
    contract: "vorton.hindsight-legacy-bank-disposition-plan.v1",
    ...input,
    legacyInventory,
    aggregateTotals,
    dispositionCounts: countDispositions(legacyInventory),
  });
  await assertLegacyBankIdentity(core);
  return hindsightLegacyBankDispositionPlanSchema.parse({
    ...core,
    planHash: await moduleLifecycleCanonicalSha256(core),
  });
}

export async function parseHindsightLegacyBankDispositionPlan(
  value: unknown,
  expected: {
    sourceCommit: string;
    vortonInstallationId: string;
    workspaceId: string;
    realm: "personal" | "organizational";
    evaluatedAt: string;
  },
): Promise<HindsightLegacyBankDispositionPlan> {
  const expectedSourceCommit = sourceCommit.parse(expected.sourceCommit);
  const expectedInstallationId = canonicalUuid.parse(
    expected.vortonInstallationId,
  );
  const expectedWorkspaceId = canonicalUuid.parse(expected.workspaceId);
  const expectedRealm = realmSchema.parse(expected.realm);
  const evaluatedAt = Date.parse(utcMilliseconds.parse(expected.evaluatedAt));
  const plan = hindsightLegacyBankDispositionPlanSchema.parse(value);
  if (plan.sourceCommit !== expectedSourceCommit) {
    throw new Error(
      "Disposition plan source commit does not match expected source",
    );
  }
  if (
    plan.scope.vortonInstallationId !== expectedInstallationId ||
    plan.scope.workspaceId !== expectedWorkspaceId ||
    plan.scope.realm !== expectedRealm
  ) {
    throw new Error(
      "Disposition plan scope does not match the expected workspace",
    );
  }
  if (
    evaluatedAt < Date.parse(plan.plannedAt) ||
    evaluatedAt > Date.parse(plan.expiresAt)
  ) {
    throw new Error(
      "Disposition plan is not valid at the expected evaluation time",
    );
  }
  await assertLegacyBankIdentity(plan);
  const computedHash = await moduleLifecycleCanonicalSha256(
    projectHindsightLegacyBankDispositionPlanCore(plan),
  );
  if (computedHash !== plan.planHash) {
    throw new Error("Disposition plan hash does not match its canonical core");
  }
  return plan;
}

async function assertLegacyBankIdentity(
  plan: HindsightLegacyBankDispositionPlanCore,
): Promise<void> {
  const inventory = plan.legacyInventory;
  if (inventory.length === 0) return;
  const expectedIdentity = await hashHindsightExternalBankId(
    canonicalLegacyV1Bank(plan.scope),
  );
  if (inventory[0]!.externalBankIdSha256 !== expectedIdentity) {
    throw new Error(
      "Legacy inventory does not identify the exact installation lineage-v1 bank",
    );
  }
}
