import { describe, expect, it } from "vitest";

import {
  createHindsightLegacyBankDispositionPlan,
  hashHindsightExternalBankId,
  hashHindsightLegacyBankDispositionPlanCore,
  hindsightLegacyBankDispositionPlanSchema,
  parseHindsightLegacyBankDispositionPlan,
  projectHindsightLegacyBankDispositionPlanCore,
  type CreateHindsightLegacyBankDispositionPlanInput,
  type HindsightLegacyBankDispositionPlan,
  type HindsightLegacyBankInventoryEntry,
} from "./memory-lineage.js";

const installationId = "11111111-1111-4111-a111-111111111111";
const workspaceId = "22222222-2222-4222-a222-222222222222";
const sourceCommit = "a".repeat(40);
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const legacyBankId = `organizational:${installationId}:default`;
const legacyBankIdSha256 =
  "sha256:0c8ba041028cfb9e7b2a9f302538b6f2413986cfe0ba9020c6b1b972122b2c7c";
const expectedScope = {
  sourceCommit,
  vortonInstallationId: installationId,
  workspaceId,
  realm: "organizational" as const,
  evaluatedAt: "2026-08-31T08:04:00.000Z",
};

const rebuildBank: HindsightLegacyBankInventoryEntry = {
  externalBankIdSha256: legacyBankIdSha256,
  inventoryEvidenceSha256: digest("5"),
  legacyFamily: "installation-default-lineage-v1",
  validFactCount: 1,
  invalidatedFactCount: 1,
  factCount: 2,
  observationCount: 1,
  pendingConsolidationCount: 0,
  failedConsolidationCount: 1,
  canonicalSourceCoveredFactCount: 2,
  canonicalSourceUncoveredFactCount: 0,
  disposition: "rebuild",
};

const quarantineBank: HindsightLegacyBankInventoryEntry = {
  externalBankIdSha256: legacyBankIdSha256,
  inventoryEvidenceSha256: digest("6"),
  legacyFamily: "installation-default-lineage-v1",
  validFactCount: 2,
  invalidatedFactCount: 0,
  factCount: 2,
  observationCount: 2,
  pendingConsolidationCount: 1,
  failedConsolidationCount: 1,
  canonicalSourceCoveredFactCount: 0,
  canonicalSourceUncoveredFactCount: 2,
  disposition: "quarantine",
};

function planInput(
  legacyInventory: HindsightLegacyBankInventoryEntry[] = [rebuildBank],
): CreateHindsightLegacyBankDispositionPlanInput {
  return {
    sourceCommit,
    scope: {
      vortonInstallationId: installationId,
      workspaceId,
      realm: "organizational",
      assignment: {
        mode: "explicit",
        evidenceSha256: digest("1"),
        workspaceInferred: false,
      },
    },
    target: {
      adapter: "hindsight",
      externalBankId: `organizational:${installationId}:${workspaceId}:lineage-v2`,
      lineage: "lineage-v2",
      requiredState: "absent",
      freshness: {
        evidenceSha256: digest("2"),
        observedAt: "2026-08-31T07:55:00.000Z",
        maximumAgeSeconds: 600,
        reportedCounts: {
          banks: 0,
          facts: 0,
          observations: 0,
          consolidations: 0,
        },
      },
    },
    inventoryEvidenceBundleSha256: digest("7"),
    inventoryEvidenceObservedAt: "2026-08-31T07:56:00.000Z",
    inventoryMaximumAgeSeconds: 600,
    legacyInventory,
    canonicalSources: {
      sourceRevisionCount: 2,
      citationCount: 2,
      sourceRevisionEvidenceSha256: digest("3"),
      citationEvidenceSha256: digest("4"),
    },
    transferPolicy: {
      copyProviderDerivedState: false,
      copyProviderFacts: false,
      copyProviderObservations: false,
      copyProviderConsolidations: false,
      rebuildFromCanonicalVortonSourcesOnly: true,
    },
    evidencePolicy: {
      suppliedDigestsAndCountsOnly: true,
      liveInspectionPerformed: false,
      rawExternalBankIdsIncluded: false,
      rawMemoryContentIncluded: false,
      personalRecordsIncluded: false,
    },
    authority: {
      planOnly: true,
      grantsAuthority: false,
      separateApprovalRequired: true,
      liveWorkspaceMembershipRequired: true,
      recentAal2Required: true,
      rolesGrantAuthority: false,
      workspaceMembershipChecked: false,
      aal2Checked: false,
      approvalCreated: false,
      executionAuthorized: false,
      migrationAuthorized: false,
      retirementAuthorized: false,
      providerReadAuthorized: false,
      providerWriteAuthorized: false,
      postgresMutationAuthorized: false,
      targetActivationAuthorized: false,
      targetAbsenceRecheckRequired: true,
      externalMutationAuthorized: false,
    },
    effects: {
      providerReadPerformed: false,
      providerWritePerformed: false,
      postgresWritePerformed: false,
      targetCreated: false,
      legacyBankMutated: false,
      personalDataRead: false,
      authorityCreated: false,
      receiptCreated: false,
    },
    plannedAt: "2026-08-31T08:00:00.000Z",
    expiresAt: "2026-08-31T08:05:00.000Z",
  };
}

async function makePlan(): Promise<HindsightLegacyBankDispositionPlan> {
  return createHindsightLegacyBankDispositionPlan(planInput());
}

describe("Hindsight legacy-bank disposition plan", () => {
  it("produces one deterministic content-addressed plan", async () => {
    const first = await makePlan();
    const replay = await makePlan();

    expect(replay).toEqual(first);
    expect(first.legacyInventory).toHaveLength(1);
    expect(first.legacyInventory[0]?.externalBankIdSha256).toBe(
      legacyBankIdSha256,
    );
    expect(first.aggregateTotals).toEqual({
      bankCount: 1,
      validFactCount: 1,
      invalidatedFactCount: 1,
      factCount: 2,
      observationCount: 1,
      pendingConsolidationCount: 0,
      failedConsolidationCount: 1,
      canonicalSourceCoveredFactCount: 2,
      canonicalSourceUncoveredFactCount: 0,
    });
    expect(first.dispositionCounts).toEqual({
      rebuild: 1,
      quarantine: 0,
      discard: 0,
      total: 1,
    });
    expect(first.planHash).toBe(
      "sha256:7b1087574f9740491e4763e9c3f3441824ada5824798e2f592f2d3033d9a197a",
    );
    expect(await hashHindsightLegacyBankDispositionPlanCore(first)).toBe(
      first.planHash,
    );
    await expect(
      parseHindsightLegacyBankDispositionPlan(first, expectedScope),
    ).resolves.toEqual(first);
  });

  it("defines the external-bank digest as SHA-256 of exact UTF-8 bytes", async () => {
    await expect(hashHindsightExternalBankId(legacyBankId)).resolves.toBe(
      legacyBankIdSha256,
    );
    await expect(
      hashHindsightExternalBankId(JSON.stringify(legacyBankId)),
    ).resolves.not.toBe(legacyBankIdSha256);
  });

  it("represents proven legacy-bank absence without inventing work", async () => {
    const plan = await createHindsightLegacyBankDispositionPlan(planInput([]));

    expect(plan.legacyInventory).toEqual([]);
    expect(plan.aggregateTotals).toEqual({
      bankCount: 0,
      validFactCount: 0,
      invalidatedFactCount: 0,
      factCount: 0,
      observationCount: 0,
      pendingConsolidationCount: 0,
      failedConsolidationCount: 0,
      canonicalSourceCoveredFactCount: 0,
      canonicalSourceUncoveredFactCount: 0,
    });
    expect(plan.dispositionCounts).toEqual({
      rebuild: 0,
      quarantine: 0,
      discard: 0,
      total: 0,
    });
    await expect(
      parseHindsightLegacyBankDispositionPlan(plan, expectedScope),
    ).resolves.toEqual(plan);
  });

  it("accepts only the exact deterministic installation lineage-v1 bank", async () => {
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([{ ...rebuildBank, externalBankIdSha256: digest("a") }]),
      ),
    ).rejects.toThrow(/exact installation lineage-v1 bank/);
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([rebuildBank, rebuildBank]),
      ),
    ).rejects.toThrow();
  });

  it("rejects exact fact, coverage, and consolidation arithmetic defects", async () => {
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([{ ...rebuildBank, factCount: 3 }]),
      ),
    ).rejects.toThrow(/Valid and invalidated facts/);
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([{ ...rebuildBank, canonicalSourceCoveredFactCount: 1 }]),
      ),
    ).rejects.toThrow(/Canonical source coverage/);
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([
          {
            ...quarantineBank,
            pendingConsolidationCount: 2,
            failedConsolidationCount: 1,
          },
        ]),
      ),
    ).rejects.toThrow(/cannot exceed valid source facts/);
  });

  it("enforces rebuild and discard safety", async () => {
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([{ ...rebuildBank, pendingConsolidationCount: 1 }]),
      ),
    ).rejects.toThrow(/Rebuild requires zero pending/);
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([
          {
            ...rebuildBank,
            disposition: "discard",
            failedConsolidationCount: 1,
          },
        ]),
      ),
    ).rejects.toThrow(/Discard requires zero pending and failed/);
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([
          {
            ...rebuildBank,
            disposition: "discard",
            failedConsolidationCount: 0,
            canonicalSourceCoveredFactCount: 1,
            canonicalSourceUncoveredFactCount: 1,
          },
        ]),
      ),
    ).rejects.toThrow(/require canonical source coverage/);
  });

  it("requires source and citation evidence for fact-bearing rebuild or discard", async () => {
    const input = planInput();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        canonicalSources: {
          ...input.canonicalSources,
          sourceRevisionCount: 0,
          citationCount: 0,
        },
      }),
    ).rejects.toThrow(/require canonical source revisions and citations/);
  });

  it("requires distinct evidence and identity digest roles", async () => {
    const input = planInput();
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([
          {
            ...rebuildBank,
            inventoryEvidenceSha256: input.inventoryEvidenceBundleSha256,
          },
        ]),
      ),
    ).rejects.toThrow(/evidence roles require distinct digests/);
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([
          {
            ...rebuildBank,
            inventoryEvidenceSha256: rebuildBank.externalBankIdSha256,
          },
        ]),
      ),
    ).rejects.toThrow(/identity and evidence digest roles must be distinct/);
  });

  it("requires explicit assignment and the exact workspace target", async () => {
    const input = planInput();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        scope: {
          ...input.scope,
          assignment: {
            ...input.scope.assignment,
            workspaceInferred: true as false,
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        target: {
          ...input.target,
          externalBankId: `organizational:${installationId}:33333333-3333-4333-a333-333333333333:lineage-v2`,
        },
      }),
    ).rejects.toThrow(/exact workspace lineage-v2 bank/);
  });

  it("requires current evidence for inventories and target absence", async () => {
    const input = planInput();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        target: {
          ...input.target,
          freshness: {
            ...input.target.freshness,
            observedAt: "2026-08-31T07:49:59.999Z",
          },
        },
      }),
    ).rejects.toThrow(/no more than 600 seconds old/);
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        inventoryEvidenceObservedAt: "2026-08-31T07:49:59.999Z",
      }),
    ).rejects.toThrow(/no more than 600 seconds old/);
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        expiresAt: "2026-08-31T08:05:00.001Z",
      }),
    ).rejects.toThrow(/cannot outlive its supplied freshness evidence/);
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        expiresAt: "2026-08-31T08:10:00.001Z",
      }),
    ).rejects.toThrow(/within 600 seconds/);
  });

  it("requires zero target bank and content counts", async () => {
    const input = planInput();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        target: {
          ...input.target,
          freshness: {
            ...input.target.freshness,
            reportedCounts: {
              banks: 1 as 0,
              facts: 0,
              observations: 0,
              consolidations: 0,
            },
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        target: {
          ...input.target,
          freshness: {
            ...input.target.freshness,
            reportedCounts: {
              banks: 0,
              facts: 1 as 0,
              observations: 0,
              consolidations: 0,
            },
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("binds authoritative parsing to source, installation, workspace, and realm", async () => {
    const plan = await makePlan();
    await expect(
      parseHindsightLegacyBankDispositionPlan(plan, {
        ...expectedScope,
        sourceCommit: "b".repeat(40),
      }),
    ).rejects.toThrow(/source commit does not match/);
    await expect(
      parseHindsightLegacyBankDispositionPlan(plan, {
        ...expectedScope,
        vortonInstallationId: "33333333-3333-4333-a333-333333333333",
      }),
    ).rejects.toThrow(/scope does not match/);
    await expect(
      parseHindsightLegacyBankDispositionPlan(plan, {
        ...expectedScope,
        workspaceId: "33333333-3333-4333-a333-333333333333",
      }),
    ).rejects.toThrow(/scope does not match/);
    await expect(
      parseHindsightLegacyBankDispositionPlan(plan, {
        ...expectedScope,
        realm: "personal",
      }),
    ).rejects.toThrow(/scope does not match/);
    await expect(
      parseHindsightLegacyBankDispositionPlan(plan, {
        ...expectedScope,
        evaluatedAt: "2026-08-31T08:05:00.001Z",
      }),
    ).rejects.toThrow(/not valid at the expected evaluation time/);
  });

  it("rejects a rehashed plan that substitutes the legacy-bank identity", async () => {
    const plan = await makePlan();
    const core = {
      ...projectHindsightLegacyBankDispositionPlanCore(plan),
      legacyInventory: [
        { ...plan.legacyInventory[0]!, externalBankIdSha256: digest("a") },
      ],
    };
    const candidate = {
      ...core,
      planHash: await hashHindsightLegacyBankDispositionPlanCore(core),
    };

    await expect(
      parseHindsightLegacyBankDispositionPlan(candidate, expectedScope),
    ).rejects.toThrow(/exact installation lineage-v1 bank/);
  });

  it("detects aggregate, disposition, and content-address tampering", async () => {
    const plan = await makePlan();
    expect(() =>
      hindsightLegacyBankDispositionPlanSchema.parse({
        ...plan,
        aggregateTotals: { ...plan.aggregateTotals, factCount: 4 },
      }),
    ).toThrow(/Aggregate totals/);
    expect(() =>
      hindsightLegacyBankDispositionPlanSchema.parse({
        ...plan,
        dispositionCounts: { ...plan.dispositionCounts, rebuild: 0 },
      }),
    ).toThrow(/Disposition counts/);
    await expect(
      parseHindsightLegacyBankDispositionPlan(
        { ...plan, planHash: digest("f") },
        expectedScope,
      ),
    ).rejects.toThrow(/hash does not match/);
  });

  it("rejects noncanonical identifiers, timestamps, hashes, and source commits", async () => {
    const input = planInput();
    const cases: unknown[] = [
      {
        ...input,
        scope: { ...input.scope, workspaceId: workspaceId.toUpperCase() },
      },
      { ...input, plannedAt: "2026-08-31T08:00:00Z" },
      { ...input, sourceCommit: "A".repeat(40) },
      {
        ...input,
        scope: {
          ...input.scope,
          assignment: {
            ...input.scope.assignment,
            evidenceSha256: `sha256:${"A".repeat(64)}`,
          },
        },
      },
    ];
    for (const candidate of cases) {
      await expect(
        createHindsightLegacyBankDispositionPlan(
          candidate as CreateHindsightLegacyBankDispositionPlanInput,
        ),
      ).rejects.toThrow();
    }
  });

  it("rejects unknown fields and raw legacy bank identifiers", async () => {
    const plan = await makePlan();
    expect(() =>
      hindsightLegacyBankDispositionPlanSchema.parse({
        ...plan,
        unexpected: true,
      }),
    ).toThrow();
    await expect(
      createHindsightLegacyBankDispositionPlan(
        planInput([
          {
            ...rebuildBank,
            externalBankId: "legacy-bank-name",
          } as HindsightLegacyBankInventoryEntry,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("keeps planning no-effect and copies no provider-derived state", async () => {
    const input = planInput();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        authority: { ...input.authority, executionAuthorized: true as false },
      }),
    ).rejects.toThrow();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        authority: {
          ...input.authority,
          postgresMutationAuthorized: true as false,
        },
      }),
    ).rejects.toThrow();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        effects: { ...input.effects, providerReadPerformed: true as false },
      }),
    ).rejects.toThrow();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        evidencePolicy: {
          ...input.evidencePolicy,
          liveInspectionPerformed: true as false,
        },
      }),
    ).rejects.toThrow();
    await expect(
      createHindsightLegacyBankDispositionPlan({
        ...input,
        transferPolicy: {
          ...input.transferPolicy,
          copyProviderDerivedState: true as false,
        },
      }),
    ).rejects.toThrow();
  });

  it("projects only the canonical plan core", async () => {
    const core = projectHindsightLegacyBankDispositionPlanCore(
      await makePlan(),
    );
    expect(core).not.toHaveProperty("planHash");
    expect(core.contract).toBe(
      "vorton.hindsight-legacy-bank-disposition-plan.v1",
    );
  });

  it("contains no customer-specific product identity", async () => {
    const serialized = JSON.stringify(await makePlan());
    expect(serialized).not.toMatch(/AubOS|FreedOS/i);
  });
});
