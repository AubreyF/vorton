import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deriveWorkspaceCoreSurface,
  hashWorkspaceCoreSurfaceSelectionApprovalCore,
  hashWorkspaceCoreSurfaceSelectionApprovalReceipt,
  hashWorkspaceCoreSurfaceSelectionReceipt,
  workspaceCompiledCoreSurfaceRegistrySha256,
  type WorkspaceCoreSurfaceSelectionApproval,
  type WorkspaceCoreSurfaceSelectionApprovalCreation,
  type WorkspaceCoreSurfaceSelectionApprovalReceipt,
  type WorkspaceCoreSurfaceSelectionReceipt,
  type WorkspaceCoreSurfacePreferences,
  type WorkspaceCoreSurface,
} from "@vorton/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyWorkspaceCoreSurfaceSelection,
  approveWorkspaceCoreSurfaceSelection,
  buildWorkspaceCoreSurfaceSelectionPlan,
  parseWorkspaceCoreSurfaceSelectionPlan,
  readWorkspaceCoreSurfaceSelectionPlanInput,
  runWorkspaceCoreSurfaceSelectionCli,
  verifyWorkspaceCoreSurfaceSelection,
  type WorkspaceCoreSurfaceSelectionPlan,
  type WorkspaceCoreSurfaceSelectionPlanInput,
} from "./select-workspace-core-surface.js";

const ids = {
  installation: "10000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000002",
  owner: "10000000-0000-4000-8000-000000000003",
  work: "10000000-0000-4000-8000-000000000004",
  policy: "10000000-0000-4000-8000-000000000005",
  grant: "10000000-0000-4000-8000-000000000006",
  predecessor: "10000000-0000-4000-8000-000000000007",
  approval: "10000000-0000-4000-8000-000000000008",
  approvalRecord: "10000000-0000-4000-8000-000000000009",
  approvalReceipt: "10000000-0000-4000-8000-00000000000a",
  receipt: "10000000-0000-4000-8000-00000000000b",
} as const;

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const bearer = "synthetic.header.signature";
const approvedAt = "2026-08-31T18:00:00.000Z";
const expiresAt = "2026-09-01T18:00:00.000Z";
const appliedAt = "2026-08-31T18:05:00.000Z";

const currentSurface: WorkspaceCoreSurface = {
  defaultModuleId: "command",
  modules: [
    {
      id: "command",
      contractVersion: "v1",
      label: "Command Bridge",
      navigationOrder: 10,
      presentationVariant: "standard",
    },
  ],
};

const targetPreferences: WorkspaceCoreSurfacePreferences = {
  defaultCoreSurfaceId: "command",
  coreSurfaces: [
    { id: "command", navigationOrder: 10 },
    { id: "factory", navigationOrder: 20 },
  ],
};
const targetSurface = deriveWorkspaceCoreSurface(targetPreferences);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function input(
  overrides: Partial<WorkspaceCoreSurfaceSelectionPlanInput> = {},
): WorkspaceCoreSurfaceSelectionPlanInput {
  return {
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    approvalId: ids.approval,
    workId: ids.work,
    capabilityGrantId: ids.grant,
    expiresAt,
    currentSurface,
    predecessorCoreSurfaceSelectionReceipt: {
      receiptId: ids.predecessor,
      receiptSha256: digest("7"),
    },
    targetPreferences,
    ...overrides,
  };
}

async function fixtureFiles(): Promise<{
  directory: string;
  currentPath: string;
  targetPreferencesPath: string;
  planPath: string;
  approvalPath: string;
  receiptPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "vorton-module-plan-"));
  temporaryDirectories.push(directory);
  const currentPath = join(directory, "current.json");
  const targetPreferencesPath = join(directory, "target-preferences.json");
  const planPath = join(directory, "plan.json");
  const approvalPath = join(directory, "approval.json");
  const receiptPath = join(directory, "receipt.json");
  await writeFile(currentPath, JSON.stringify(currentSurface));
  await writeFile(targetPreferencesPath, JSON.stringify(targetPreferences));
  return {
    directory,
    currentPath,
    targetPreferencesPath,
    planPath,
    approvalPath,
    receiptPath,
  };
}

function planEnvironment(files: Awaited<ReturnType<typeof fixtureFiles>>) {
  return {
    VORTON_CORE_SURFACE_SELECTION_INSTALLATION_ID: ids.installation,
    VORTON_CORE_SURFACE_SELECTION_WORKSPACE_ID: ids.workspace,
    VORTON_CORE_SURFACE_SELECTION_APPROVAL_ID: ids.approval,
    VORTON_CORE_SURFACE_SELECTION_WORK_ID: ids.work,
    VORTON_CORE_SURFACE_SELECTION_CAPABILITY_GRANT_ID: ids.grant,
    VORTON_CORE_SURFACE_SELECTION_EXPIRES_AT: expiresAt,
    VORTON_CORE_SURFACE_SELECTION_CURRENT_SURFACE_PATH: files.currentPath,
    VORTON_CORE_SURFACE_SELECTION_TARGET_PREFERENCES_PATH:
      files.targetPreferencesPath,
    VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_ID: ids.predecessor,
    VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_SHA256: digest("7"),
  };
}

function apiEnvironment() {
  return {
    VORTON_CORE_SURFACE_SELECTION_API_URL: "https://vorton.invalid",
    VORTON_CORE_SURFACE_SELECTION_BEARER_TOKEN: bearer,
  };
}

async function makeApprovalCreation(
  plan: WorkspaceCoreSurfaceSelectionPlan,
): Promise<WorkspaceCoreSurfaceSelectionApprovalCreation> {
  const binding: WorkspaceCoreSurfaceSelectionApproval["binding"] = {
    vortonInstallationId: plan.vortonInstallationId,
    workspaceId: plan.workspaceId,
    realm: "organizational" as const,
    workId: plan.approval.workId,
    workSnapshotSha256: digest("1"),
    currentSurface: plan.transition.currentSurface,
    currentSurfaceSha256: plan.transition.currentSurfaceSha256,
    compiledRegistrySha256: workspaceCompiledCoreSurfaceRegistrySha256,
    predecessorCoreSurfaceSelectionReceipt:
      plan.transition.predecessorCoreSurfaceSelectionReceipt,
    targetPreferences: plan.transition.targetPreferences,
    targetSurface: plan.transition.targetSurface,
    targetSurfaceSha256: plan.transition.targetSurfaceSha256,
  };
  const authority = {
    principalKind: "person" as const,
    personId: ids.owner,
    workspaceMembershipKind: "owner" as const,
    capability: "workspace.core-surface.select" as const,
    mode: "modify" as const,
    workId: plan.approval.workId,
    policyId: ids.policy,
    policySha256: digest("5"),
    capabilityGrantId: plan.approval.capabilityGrantId,
    workScoped: true as const,
    rolesGrantAuthority: false as const,
  };
  const scope = {
    action: "workspace.core-surface.select" as const,
    compiledCoreSurfaceOnly: true as const,
    defaultModuleProjectionOnly: true as const,
    moduleReleaseAdmission: false as const,
    infrastructureMutation: false as const,
    otherWorkspaceRead: false as const,
    otherWorkspaceMutation: false as const,
    externalSystemMutation: false as const,
  };
  const approval: WorkspaceCoreSurfaceSelectionApproval = {
    contract: "vorton.workspace-core-surface-selection-approval.v1",
    approvalId: plan.approval.approvalId,
    approvalRecordId: ids.approvalRecord,
    approvalPlane: "workspace-postgres",
    ownerPersonId: ids.owner,
    binding,
    authority,
    approvedAt,
    expiresAt: plan.approval.expiresAt,
    aal2VerifiedAt: "2026-08-31T17:55:00.000Z",
    assuranceLevel: "aal2",
    ownerMembershipVerifiedAt: approvedAt,
    policyVerifiedAt: approvedAt,
    capabilityGrantVerifiedAt: approvedAt,
    workVerifiedAt: approvedAt,
    currentSurfaceVerifiedAt: approvedAt,
    scope,
    rolesGrantAuthority: false,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: digest("f"),
  };
  const approvalHash =
    await hashWorkspaceCoreSurfaceSelectionApprovalCore(approval);
  const approvalReceipt: WorkspaceCoreSurfaceSelectionApprovalReceipt = {
    contract: "vorton.workspace-core-surface-selection-approval-receipt.v1",
    receiptId: ids.approvalReceipt,
    receiptPlane: "workspace-postgres",
    approvalId: approval.approvalId,
    approvalRecordId: approval.approvalRecordId,
    approvalHash,
    ownerPersonId: ids.owner,
    binding,
    authority,
    approvedAt,
    expiresAt: plan.approval.expiresAt,
    createdAt: approvedAt,
    aal2VerifiedAt: approval.aal2VerifiedAt,
    assuranceLevel: "aal2",
    ownerMembershipVerifiedAt: approvedAt,
    policyVerifiedAt: approvedAt,
    capabilityGrantVerifiedAt: approvedAt,
    workVerifiedAt: approvedAt,
    currentSurfaceVerifiedAt: approvedAt,
    scope,
    rolesGrantAuthority: false,
    effects: {
      approvalCreated: true,
      approvalConsumed: false,
      coreSurfaceProjectionMutated: false,
      defaultCoreSurfaceProjectionMutated: false,
      coreSurfaceSelectionLineageMutated: false,
      moduleReleaseAdmitted: false,
      infrastructureMutated: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      workMutated: false,
      policyMutated: false,
      capabilityGrantMutated: false,
      externalSystemMutated: false,
      artifactResolved: false,
      artifactLoaded: false,
      moduleRuntimeStarted: false,
      moduleAdmitted: false,
      moduleMigrated: false,
      privateConsumerAuthorityGranted: false,
    },
    receiptHash: digest("e"),
  };
  approvalReceipt.receiptHash =
    await hashWorkspaceCoreSurfaceSelectionApprovalReceipt(approvalReceipt);
  approval.approvalReceiptSha256 = approvalReceipt.receiptHash;
  return { approval, approvalReceipt };
}

async function makeReceipt(
  plan: WorkspaceCoreSurfaceSelectionPlan,
  creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
): Promise<WorkspaceCoreSurfaceSelectionReceipt> {
  const receipt: WorkspaceCoreSurfaceSelectionReceipt = {
    contract: "vorton.workspace-core-surface-selection-receipt.v1",
    receiptId: ids.receipt,
    receiptPlane: "workspace-postgres",
    approvalId: creation.approval.approvalId,
    approvalRecordId: creation.approval.approvalRecordId,
    approvalReceiptId: creation.approvalReceipt.receiptId,
    approvalReceiptSha256: creation.approvalReceipt.receiptHash,
    approvalHash: creation.approvalReceipt.approvalHash,
    binding: creation.approval.binding,
    authority: creation.approval.authority,
    scope: creation.approval.scope,
    approvedByPersonId: ids.owner,
    appliedByPersonId: ids.owner,
    approvalConsumptionCount: 1,
    approvalConsumedAt: appliedAt,
    appliedAt,
    aal2VerifiedAt: approvedAt,
    assuranceLevel: "aal2",
    ownerMembershipVerifiedAt: appliedAt,
    policyVerifiedAt: appliedAt,
    capabilityGrantVerifiedAt: appliedAt,
    workSnapshotVerifiedAt: appliedAt,
    currentSurfaceVerifiedAt: appliedAt,
    predecessorCoreSurfaceSelectionReceipt:
      plan.transition.predecessorCoreSurfaceSelectionReceipt,
    preimageSurface: plan.transition.currentSurface,
    preimageSurfaceSha256: plan.transition.currentSurfaceSha256,
    postimageSurface: plan.transition.targetSurface,
    postimageSurfaceSha256: plan.transition.targetSurfaceSha256,
    rowCounts: {
      preimageCoreSurfaceRows: 1,
      deletedCoreSurfaceRows: 1,
      insertedCoreSurfaceRows: 2,
      postimageCoreSurfaceRows: 2,
      defaultCoreSurfaceRowsUpdated: 1,
      coreSurfaceSelectionLineageRowsUpdated: 1,
      otherWorkspaceRowsRead: 0,
      otherWorkspaceRowsMutated: 0,
    },
    idempotency: {
      key: ids.receipt,
      exactReplayReturnsSameReceipt: true,
      conflictingReplayDenied: true,
      additionalProjectionMutationsOnReplay: 0,
    },
    effects: {
      approvalConsumed: true,
      coreSurfaceProjectionReplaced: true,
      defaultCoreSurfaceProjectionReplaced: true,
      coreSurfaceSelectionLineageAdvanced: true,
      moduleReleaseAdmitted: false,
      infrastructureMutated: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      workMutated: false,
      policyMutated: false,
      capabilityGrantMutated: false,
      externalSystemMutated: false,
      artifactResolved: false,
      artifactLoaded: false,
      moduleRuntimeStarted: false,
      moduleAdmitted: false,
      moduleMigrated: false,
      privateConsumerAuthorityGranted: false,
    },
    receiptHash: digest("d"),
  };
  receipt.receiptHash = await hashWorkspaceCoreSurfaceSelectionReceipt(receipt);
  return receipt;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("workspace core-surface selection operator", () => {
  it("builds one stable secret-free plan without network access", async () => {
    const files = await fixtureFiles();
    const fetchFixture = vi.fn<typeof fetch>(() => {
      throw new Error("network must not be called");
    });
    const emitted: unknown[] = [];
    const env = {
      ...planEnvironment(files),
      VORTON_CORE_SURFACE_SELECTION_BEARER_TOKEN: bearer,
    };
    const first = await runWorkspaceCoreSurfaceSelectionCli({
      argv: ["--plan"],
      env,
      requestFetch: fetchFixture,
      emit: (value) => emitted.push(value),
    });
    const second = await buildWorkspaceCoreSurfaceSelectionPlan(
      await readWorkspaceCoreSurfaceSelectionPlanInput(env),
    );
    expect(second).toEqual(first);
    expect(fetchFixture).not.toHaveBeenCalled();
    expect(emitted).toEqual([first]);
    expect(JSON.stringify(first)).not.toContain(bearer);
    expect(first).toMatchObject({
      contract: "vorton.select-workspace-core-surface.v1",
      operation: "select-workspace-core-surface",
      rollback: {
        separateApprovalRequired: true,
        ungatedRollbackCommand: false,
      },
    });
    expect((first as WorkspaceCoreSurfaceSelectionPlan).planHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect((first as WorkspaceCoreSurfaceSelectionPlan).planHash).toBe(
      "sha256:3bb6bed04e87dcd99533f59a73f5ec57421dc530a57c734ee1089d676eadb470",
    );
  });

  it("rejects unsafe files, partial lineage, and non-genesis null lineage", async () => {
    const files = await fixtureFiles();
    await expect(
      readWorkspaceCoreSurfaceSelectionPlanInput({
        ...planEnvironment(files),
        VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_SHA256: undefined,
      }),
    ).rejects.toThrow("provided together");
    await expect(
      buildWorkspaceCoreSurfaceSelectionPlan({
        ...input(),
        predecessorCoreSurfaceSelectionReceipt: null,
      }),
    ).rejects.toThrow("nonempty current surface");

    const linkedPath = join(files.directory, "linked.json");
    await symlink(files.currentPath, linkedPath);
    await expect(
      readWorkspaceCoreSurfaceSelectionPlanInput({
        ...planEnvironment(files),
        VORTON_CORE_SURFACE_SELECTION_CURRENT_SURFACE_PATH: linkedPath,
      }),
    ).rejects.toThrow("non-symlink");
    await writeFile(files.targetPreferencesPath, "not json");
    await expect(
      readWorkspaceCoreSurfaceSelectionPlanInput(planEnvironment(files)),
    ).rejects.toThrow("valid JSON");
  });

  it("rejects duplicate keys in surface, plan, and approval files", async () => {
    const files = await fixtureFiles();
    const fetchFixture = vi.fn<typeof fetch>(() => {
      throw new Error("network must not be called");
    });

    await writeFile(
      files.currentPath,
      String.raw`{"defaultModuleId":"command","modules":[{"id":"command","\u0069\u0064":"factory","label":"Command \"{Bridge}\"","navigationOrder":10,"contractVersion":"v1","presentationVariant":"standard"}]}`,
    );
    await expect(
      readWorkspaceCoreSurfaceSelectionPlanInput(planEnvironment(files)),
    ).rejects.toThrow("must not contain duplicate JSON object keys");

    await writeFile(files.currentPath, JSON.stringify(currentSurface));
    const plan = await buildWorkspaceCoreSurfaceSelectionPlan(input());
    const planJson = JSON.stringify(plan).replace(
      '"scope":{"compiledCoreSurfaceOnly":true',
      '"scope":{"compiledCoreSurfaceOnly":true,"compiledCoreSurfaceOnly":true',
    );
    await writeFile(files.planPath, planJson);
    await expect(
      runWorkspaceCoreSurfaceSelectionCli({
        argv: ["--approve"],
        env: {
          ...apiEnvironment(),
          VORTON_CORE_SURFACE_SELECTION_PLAN_PATH: files.planPath,
        },
        requestFetch: fetchFixture,
      }),
    ).rejects.toThrow("must not contain duplicate JSON object keys");

    await writeFile(files.planPath, JSON.stringify(plan));
    const creation = await makeApprovalCreation(plan);
    const approvalJson = JSON.stringify(creation).replace(
      '"approval":{"contract":"vorton.workspace-core-surface-selection-approval.v1"',
      '"approval":{"contract":"vorton.workspace-core-surface-selection-approval.v1","contract":"vorton.workspace-core-surface-selection-approval.v1"',
    );
    await writeFile(files.approvalPath, approvalJson);
    await expect(
      runWorkspaceCoreSurfaceSelectionCli({
        argv: ["--apply"],
        env: {
          ...apiEnvironment(),
          VORTON_CORE_SURFACE_SELECTION_PLAN_PATH: files.planPath,
          VORTON_CORE_SURFACE_SELECTION_APPROVAL_PATH: files.approvalPath,
          VORTON_CORE_SURFACE_SELECTION_RECEIPT_ID: ids.receipt,
        },
        requestFetch: fetchFixture,
      }),
    ).rejects.toThrow("must not contain duplicate JSON object keys");
    expect(fetchFixture).not.toHaveBeenCalled();
  });

  it("rejects altered plan fields and canonical hashes", async () => {
    const plan = await buildWorkspaceCoreSurfaceSelectionPlan(input());
    await expect(parseWorkspaceCoreSurfaceSelectionPlan(plan)).resolves.toEqual(
      plan,
    );
    await expect(
      parseWorkspaceCoreSurfaceSelectionPlan({
        ...plan,
        planHash: digest("0"),
      }),
    ).rejects.toThrow("canonical hash");
    await expect(
      parseWorkspaceCoreSurfaceSelectionPlan({
        ...plan,
        transition: {
          ...plan.transition,
          predecessorCoreSurfaceSelectionReceipt: {
            ...plan.transition.predecessorCoreSurfaceSelectionReceipt,
            workspaceId: ids.workspace,
          },
        },
      }),
    ).rejects.toThrow("unexpected or missing fields");
    await expect(
      parseWorkspaceCoreSurfaceSelectionPlan({ ...plan, extra: true }),
    ).rejects.toThrow("unexpected or missing fields");
    await expect(
      parseWorkspaceCoreSurfaceSelectionPlan({
        ...plan,
        transition: {
          ...plan.transition,
          targetSurfaceSha256: digest("0"),
        },
      }),
    ).rejects.toThrow("canonical hash");
  });

  it("posts the exact approval request and validates its authority response", async () => {
    const plan = await buildWorkspaceCoreSurfaceSelectionPlan(input());
    const creation = await makeApprovalCreation(plan);
    const fetchFixture = vi.fn<typeof fetch>(async (request, init) => {
      expect(String(request)).toBe(
        `https://vorton.invalid/v1/installations/${ids.installation}/workspaces/${ids.workspace}/core-surface-selection-approvals`,
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        approvalId: ids.approval,
        workId: ids.work,
        capabilityGrantId: ids.grant,
        compiledRegistrySha256: workspaceCompiledCoreSurfaceRegistrySha256,
        expectedCurrentSurfaceSha256: plan.transition.currentSurfaceSha256,
        expectedPredecessorCoreSurfaceSelectionReceipt:
          plan.transition.predecessorCoreSurfaceSelectionReceipt,
        targetPreferences,
        expiresAt,
      });
      return jsonResponse(creation, 201);
    });
    await expect(
      approveWorkspaceCoreSurfaceSelection(
        plan,
        apiEnvironment(),
        fetchFixture,
      ),
    ).resolves.toEqual(creation);
    expect(fetchFixture).toHaveBeenCalledOnce();
  });

  it("applies one exact approval and validates its immutable receipt", async () => {
    const plan = await buildWorkspaceCoreSurfaceSelectionPlan(input());
    const creation = await makeApprovalCreation(plan);
    const receipt = await makeReceipt(plan, creation);
    const fetchFixture = vi.fn<typeof fetch>(async (request, init) => {
      expect(String(request)).toBe(
        `https://vorton.invalid/v1/installations/${ids.installation}/workspaces/${ids.workspace}/core-surface-selection-approvals/${ids.approval}/execute`,
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        receiptId: ids.receipt,
      });
      return jsonResponse({ ...creation, receipt });
    });
    await expect(
      applyWorkspaceCoreSurfaceSelection(
        plan,
        creation,
        ids.receipt,
        apiEnvironment(),
        fetchFixture,
      ),
    ).resolves.toEqual(receipt);
  });

  it("verifies the exact target surface from runtime bootstrap", async () => {
    const plan = await buildWorkspaceCoreSurfaceSelectionPlan(input());
    const creation = await makeApprovalCreation(plan);
    const receipt = await makeReceipt(plan, creation);
    const selectedWorkspace = {
      id: ids.workspace,
      moduleSurface: targetSurface,
      coreSurfaceState: "selected",
      coreSurfaceSelectionReceipt: {
        receiptId: receipt.receiptId,
        receiptSha256: receipt.receiptHash,
      },
    };
    const goodFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        installations: [
          {
            id: ids.installation,
            workspaces: [selectedWorkspace],
          },
        ],
      }),
    );
    await expect(
      verifyWorkspaceCoreSurfaceSelection(
        plan,
        creation,
        receipt,
        apiEnvironment(),
        goodFetch,
      ),
    ).resolves.toMatchObject({
      contract: "vorton.select-workspace-core-surface-verification.v1",
      planHash: plan.planHash,
      selectionReceipt: {
        receiptId: receipt.receiptId,
        receiptSha256: receipt.receiptHash,
      },
      verified: true,
    });

    const mismatchedFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        installations: [
          {
            id: ids.installation,
            workspaces: [
              { ...selectedWorkspace, moduleSurface: currentSurface },
            ],
          },
        ],
      }),
    );
    await expect(
      verifyWorkspaceCoreSurfaceSelection(
        plan,
        creation,
        receipt,
        apiEnvironment(),
        mismatchedFetch,
      ),
    ).rejects.toThrow("exact target surface");

    const laterReceiptHeadFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        installations: [
          {
            id: ids.installation,
            workspaces: [
              {
                ...selectedWorkspace,
                coreSurfaceSelectionReceipt: {
                  receiptId: "20000000-0000-4000-8000-000000000002",
                  receiptSha256: digest("2"),
                },
              },
            ],
          },
        ],
      }),
    );
    await expect(
      verifyWorkspaceCoreSurfaceSelection(
        plan,
        creation,
        receipt,
        apiEnvironment(),
        laterReceiptHeadFetch,
      ),
    ).rejects.toThrow("exact application receipt as its current head");

    const ambiguousInstallationFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        installations: [
          {
            id: ids.installation,
            workspaces: [selectedWorkspace],
          },
          {
            id: ids.installation,
            workspaces: [selectedWorkspace],
          },
        ],
      }),
    );
    await expect(
      verifyWorkspaceCoreSurfaceSelection(
        plan,
        creation,
        receipt,
        apiEnvironment(),
        ambiguousInstallationFetch,
      ),
    ).rejects.toThrow("exactly one planned installation");

    const ambiguousWorkspaceFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        installations: [
          {
            id: ids.installation,
            workspaces: [selectedWorkspace, selectedWorkspace],
          },
        ],
      }),
    );
    await expect(
      verifyWorkspaceCoreSurfaceSelection(
        plan,
        creation,
        receipt,
        apiEnvironment(),
        ambiguousWorkspaceFetch,
      ),
    ).rejects.toThrow("exactly one planned workspace");
  });

  it("requires the exact application receipt file in CLI verification mode", async () => {
    const files = await fixtureFiles();
    const plan = await buildWorkspaceCoreSurfaceSelectionPlan(input());
    const creation = await makeApprovalCreation(plan);
    const receipt = await makeReceipt(plan, creation);
    await writeFile(files.planPath, JSON.stringify(plan));
    await writeFile(files.approvalPath, JSON.stringify(creation));
    await writeFile(files.receiptPath, JSON.stringify(receipt));
    const fetchFixture = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        installations: [
          {
            id: ids.installation,
            workspaces: [
              {
                id: ids.workspace,
                moduleSurface: targetSurface,
                coreSurfaceState: "selected",
                coreSurfaceSelectionReceipt: {
                  receiptId: receipt.receiptId,
                  receiptSha256: receipt.receiptHash,
                },
              },
            ],
          },
        ],
      }),
    );
    const environment = {
      ...apiEnvironment(),
      VORTON_CORE_SURFACE_SELECTION_PLAN_PATH: files.planPath,
      VORTON_CORE_SURFACE_SELECTION_APPROVAL_PATH: files.approvalPath,
      VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH: files.receiptPath,
    };
    await expect(
      runWorkspaceCoreSurfaceSelectionCli({
        argv: ["--verify"],
        env: environment,
        requestFetch: fetchFixture,
        emit: () => undefined,
      }),
    ).resolves.toMatchObject({
      verified: true,
      selectionReceipt: {
        receiptId: receipt.receiptId,
        receiptSha256: receipt.receiptHash,
      },
    });
    await expect(
      runWorkspaceCoreSurfaceSelectionCli({
        argv: ["--verify"],
        env: {
          ...environment,
          VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH: undefined,
        },
        requestFetch: fetchFixture,
        emit: () => undefined,
      }),
    ).rejects.toThrow("VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH is required");

    await writeFile(files.receiptPath, "not json");
    await expect(
      runWorkspaceCoreSurfaceSelectionCli({
        argv: ["--verify"],
        env: environment,
        requestFetch: fetchFixture,
        emit: () => undefined,
      }),
    ).rejects.toThrow(
      "VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH must contain valid JSON",
    );

    await writeFile(files.receiptPath, JSON.stringify(receipt));
    const linkedReceiptPath = join(files.directory, "linked-receipt.json");
    await symlink(files.receiptPath, linkedReceiptPath);
    await expect(
      runWorkspaceCoreSurfaceSelectionCli({
        argv: ["--verify"],
        env: {
          ...environment,
          VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH: linkedReceiptPath,
        },
        requestFetch: fetchFixture,
        emit: () => undefined,
      }),
    ).rejects.toThrow(
      "VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH must name an existing non-symlink JSON file",
    );
    expect(fetchFixture).toHaveBeenCalledOnce();
  });

  it("redacts HTTP failures and never emits the bearer token", async () => {
    const plan = await buildWorkspaceCoreSurfaceSelectionPlan(input());
    const output: string[] = [];
    const failedFetch = vi.fn<typeof fetch>(
      async () => new Response(`provider leaked ${bearer}`, { status: 403 }),
    );
    let message = "";
    try {
      await approveWorkspaceCoreSurfaceSelection(
        plan,
        apiEnvironment(),
        failedFetch,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      output.push(message);
    }
    expect(message).toBe("Vorton API approval request failed with HTTP 403");
    expect(output.join("\n")).not.toContain(bearer);
  });

  it.each([307, 308])(
    "rejects HTTP %i redirects without forwarding the bearer token",
    async (status) => {
      const plan = await buildWorkspaceCoreSurfaceSelectionPlan(input());
      const requests: Array<{
        url: string;
        authorization: string | undefined;
      }> = [];
      const redirectingFetch = vi.fn<typeof fetch>(async (request, init) => {
        requests.push({
          url: String(request),
          authorization: (init?.headers as Record<string, string> | undefined)
            ?.authorization,
        });
        expect(init?.redirect).toBe("error");
        return new Response(null, {
          status,
          headers: { location: "https://attacker.invalid/collect" },
        });
      });

      await expect(
        approveWorkspaceCoreSurfaceSelection(
          plan,
          apiEnvironment(),
          redirectingFetch,
        ),
      ).rejects.toThrow(`request failed with HTTP ${status}`);
      expect(redirectingFetch).toHaveBeenCalledOnce();
      expect(requests).toEqual([
        {
          url: `https://vorton.invalid/v1/installations/${ids.installation}/workspaces/${ids.workspace}/core-surface-selection-approvals`,
          authorization: `Bearer ${bearer}`,
        },
      ]);
      expect(requests.some(({ url }) => url.includes("attacker.invalid"))).toBe(
        false,
      );
    },
  );

  it("models rollback only as a new independently approved target", async () => {
    const forward = await buildWorkspaceCoreSurfaceSelectionPlan(input());
    const rollback = await buildWorkspaceCoreSurfaceSelectionPlan({
      ...input({
        approvalId: "20000000-0000-4000-8000-000000000001",
        currentSurface: targetSurface,
        targetPreferences: {
          defaultCoreSurfaceId: "command",
          coreSurfaces: [{ id: "command", navigationOrder: 10 }],
        },
        predecessorCoreSurfaceSelectionReceipt: {
          receiptId: ids.receipt,
          receiptSha256: digest("b"),
        },
      }),
    });
    expect(rollback.approval.approvalId).not.toBe(forward.approval.approvalId);
    expect(rollback.transition.targetSurface).toEqual(
      forward.transition.currentSurface,
    );
    expect(rollback.rollback).toEqual({
      separateApprovalRequired: true,
      ungatedRollbackCommand: false,
    });
  });
});
