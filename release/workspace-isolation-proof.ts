import { createHash } from "node:crypto";

export const requiredWorkspaceClaims = [
  "database-read-write",
  "composite-foreign-keys",
  "row-level-security",
  "workspace-realm-authority",
  "workspace-scoped-identity-uniqueness",
  "identity-live-membership-revocation",
  "identity-recent-aal2",
  "installation-scoped-workspace-birth",
  "policy-work-approvals-records",
  "memory-retain-retrieve-delete",
  "worker-admission-credentials-jobs-logs",
  "factory-identifier-separation",
  "storage-objects",
  "secret-bindings",
  "events-queues-realtime",
  "exports",
  "backup-restore",
  "deletion-propagation",
  "audit-receipts",
  "upgrade-rollback",
] as const;

export type WorkspaceClaimId = (typeof requiredWorkspaceClaims)[number];

export interface WorkspaceIsolationProof {
  schemaVersion: 1;
  contract: "vorton.workspace-isolation-proof.v1";
  status: "passed";
  generatedAt: string;
  sourceCommit: string;
  migrationHead: string;
  workspaceContractVersion: 1;
  topology: {
    sameInstallation: true;
    distinctWorkspaceIds: true;
    personalWorkspace: { fixtureIdentity: "aubos"; realm: "personal" };
    organizationalWorkspace: {
      fixtureIdentity: "freedos";
      realm: "organizational";
    };
  };
  schema: {
    workspaceRealmAuthoritative: true;
    installationsRealmLegacyMetadataOnly: true;
    workspaceScopedWorkerNames: true;
    workspaceScopedRoleVersions: true;
    workspaceScopedPolicyVersions: true;
    workspaceScopedMemoryBanks: true;
  };
  branding: {
    installationDisplayNameNeutral: true;
    workspaceDisplayNamePresented: true;
    brandingInfersAuthority: false;
  };
  privacy: {
    fixturesOnly: true;
    containsPersonalRecords: false;
    productionSyntheticDataAllowed: false;
    inspectedLiveOrganizationalWorkspace: false;
  };
  producer: {
    repository: "AubreyF/vorton";
    sourceTreeClean: true;
    workflowConclusion: "success";
    workflowRunUrl: string;
    testReportSha256: string;
    postgresAuthoritySha256: string;
  };
  identity: {
    sharedAuthenticationPlane: true;
    livePostgresMembership: true;
    revocationImmediate: true;
    sensitiveActionsRequireRecentAal2: true;
  };
  factory: {
    vortonInstallationIdNamed: true;
    workspaceIdNamed: true;
    githubAppInstallationIdSeparatelyNamed: true;
    currentPilotAcceptedAsProof: false;
  };
  authority: {
    rolesGrantAuthority: false;
    policyCapabilitiesApprovalsAndWorkRequired: true;
    installationWorkspaceCreationApprovalPlane: true;
    runtimeRoleCanSetAuthClaims: false;
    workspaceCreationUsesSignedTransactionBoundary: true;
    workspaceCreationApprovalConsumedExactlyOnce: true;
    workspaceCreationReceiptInsertedAtomically: true;
    existingWorkspaceAuthorityBorrowedForWorkspaceCreation: false;
  };
  claims: Array<{
    id: WorkspaceClaimId;
    status: "passed";
    adversarial: true;
    evidenceSha256: string;
  }>;
  releaseBlockers: [];
  proofHash: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  description: string,
): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${description} must be an object`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${description} fields differ`,
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalValue((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

export function workspaceProofHash(proof: Record<string, unknown>): string {
  const { proofHash: _proofHash, ...unsigned } = proof;
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(unsigned)))
    .digest("hex")}`;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

export function validateWorkspaceIsolationProof(
  value: unknown,
  expected: { sourceCommit: string; migrationHead: string },
): WorkspaceIsolationProof {
  assert(value && typeof value === "object", "Workspace proof is missing");
  const proof = value as Record<string, any>;
  assertExactKeys(
    proof,
    [
      "schemaVersion",
      "contract",
      "status",
      "generatedAt",
      "sourceCommit",
      "migrationHead",
      "workspaceContractVersion",
      "topology",
      "schema",
      "branding",
      "privacy",
      "producer",
      "identity",
      "factory",
      "authority",
      "claims",
      "releaseBlockers",
      "proofHash",
    ],
    "Workspace proof",
  );
  assertExactKeys(
    proof.topology,
    [
      "sameInstallation",
      "distinctWorkspaceIds",
      "personalWorkspace",
      "organizationalWorkspace",
    ],
    "Workspace proof topology",
  );
  assertExactKeys(
    proof.topology.personalWorkspace,
    ["fixtureIdentity", "realm"],
    "Workspace proof personal fixture",
  );
  assertExactKeys(
    proof.topology.organizationalWorkspace,
    ["fixtureIdentity", "realm"],
    "Workspace proof organizational fixture",
  );
  assertExactKeys(
    proof.schema,
    [
      "workspaceRealmAuthoritative",
      "installationsRealmLegacyMetadataOnly",
      "workspaceScopedWorkerNames",
      "workspaceScopedRoleVersions",
      "workspaceScopedPolicyVersions",
      "workspaceScopedMemoryBanks",
    ],
    "Workspace proof schema",
  );
  assertExactKeys(
    proof.branding,
    [
      "installationDisplayNameNeutral",
      "workspaceDisplayNamePresented",
      "brandingInfersAuthority",
    ],
    "Workspace proof branding",
  );
  assertExactKeys(
    proof.privacy,
    [
      "fixturesOnly",
      "containsPersonalRecords",
      "productionSyntheticDataAllowed",
      "inspectedLiveOrganizationalWorkspace",
    ],
    "Workspace proof privacy",
  );
  assertExactKeys(
    proof.producer,
    [
      "repository",
      "sourceTreeClean",
      "workflowConclusion",
      "workflowRunUrl",
      "testReportSha256",
      "postgresAuthoritySha256",
    ],
    "Workspace proof producer",
  );
  assertExactKeys(
    proof.identity,
    [
      "sharedAuthenticationPlane",
      "livePostgresMembership",
      "revocationImmediate",
      "sensitiveActionsRequireRecentAal2",
    ],
    "Workspace proof identity",
  );
  assertExactKeys(
    proof.factory,
    [
      "vortonInstallationIdNamed",
      "workspaceIdNamed",
      "githubAppInstallationIdSeparatelyNamed",
      "currentPilotAcceptedAsProof",
    ],
    "Workspace proof factory",
  );
  assertExactKeys(
    proof.authority,
    [
      "rolesGrantAuthority",
      "policyCapabilitiesApprovalsAndWorkRequired",
      "installationWorkspaceCreationApprovalPlane",
      "runtimeRoleCanSetAuthClaims",
      "workspaceCreationUsesSignedTransactionBoundary",
      "workspaceCreationApprovalConsumedExactlyOnce",
      "workspaceCreationReceiptInsertedAtomically",
      "existingWorkspaceAuthorityBorrowedForWorkspaceCreation",
    ],
    "Workspace proof authority",
  );
  assert(proof.schemaVersion === 1, "Workspace proof schema is unsupported");
  assert(
    proof.contract === "vorton.workspace-isolation-proof.v1",
    "Workspace proof contract is unsupported",
  );
  assert(proof.status === "passed", "Workspace proof did not pass");
  assert(
    typeof proof.generatedAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(proof.generatedAt) &&
      Number.isFinite(Date.parse(proof.generatedAt)),
    "Workspace proof time is invalid",
  );
  assert(
    proof.sourceCommit === expected.sourceCommit,
    "Workspace proof source commit differs",
  );
  assert(
    proof.migrationHead === expected.migrationHead,
    "Workspace proof migration head differs",
  );
  assert(
    proof.workspaceContractVersion === 1,
    "Workspace proof contract version differs",
  );
  assert(
    proof.topology?.sameInstallation === true,
    "Workspace proof does not use one installation",
  );
  assert(
    proof.topology?.distinctWorkspaceIds === true,
    "Workspace proof reuses a workspace identity",
  );
  assert(
    proof.topology?.personalWorkspace?.fixtureIdentity === "aubos" &&
      proof.topology?.personalWorkspace?.realm === "personal",
    "Workspace proof lacks the controlled personal fixture",
  );
  assert(
    proof.topology?.organizationalWorkspace?.fixtureIdentity === "freedos" &&
      proof.topology?.organizationalWorkspace?.realm === "organizational",
    "Workspace proof lacks the controlled organizational fixture",
  );
  assert(
    proof.schema?.workspaceRealmAuthoritative === true,
    "Workspace realm is not authoritative",
  );
  assert(
    proof.schema?.installationsRealmLegacyMetadataOnly === true,
    "Installation realm is still authoritative",
  );
  assert(
    proof.schema?.workspaceScopedWorkerNames === true,
    "Worker names remain installation wide",
  );
  assert(
    proof.schema?.workspaceScopedRoleVersions === true,
    "Role versions remain installation wide",
  );
  assert(
    proof.schema?.workspaceScopedPolicyVersions === true,
    "Policy versions remain installation wide",
  );
  assert(
    proof.schema?.workspaceScopedMemoryBanks === true,
    "Memory banks remain installation wide",
  );
  assert(
    proof.branding?.installationDisplayNameNeutral === true,
    "Installation branding is workspace specific",
  );
  assert(
    proof.branding?.workspaceDisplayNamePresented === true,
    "Workspace branding is not presented",
  );
  assert(
    proof.branding?.brandingInfersAuthority === false,
    "Branding infers workspace authority",
  );
  assert(
    proof.privacy?.fixturesOnly === true,
    "Workspace proof did not use controlled fixtures",
  );
  assert(
    proof.privacy?.containsPersonalRecords === false,
    "Workspace proof contains personal records",
  );
  assert(
    proof.privacy?.productionSyntheticDataAllowed === false,
    "Workspace proof permits synthetic production data",
  );
  assert(
    proof.privacy?.inspectedLiveOrganizationalWorkspace === false,
    "Workspace proof inspected a live organizational workspace",
  );
  assert(
    proof.producer?.repository === "AubreyF/vorton",
    "Workspace proof repository differs",
  );
  assert(
    proof.producer?.sourceTreeClean === true,
    "Workspace proof source tree was dirty",
  );
  assert(
    proof.producer?.workflowConclusion === "success",
    "Workspace proof workflow did not pass",
  );
  assert(
    typeof proof.producer?.workflowRunUrl === "string" &&
      /^https:\/\/github\.com\/AubreyF\/vorton\/actions\/runs\/[1-9][0-9]*$/.test(
        proof.producer.workflowRunUrl,
      ),
    "Workspace proof workflow run is invalid",
  );
  assert(
    digest(proof.producer?.testReportSha256),
    "Workspace test report digest is invalid",
  );
  assert(
    digest(proof.producer?.postgresAuthoritySha256),
    "Workspace PostgreSQL proof digest is invalid",
  );
  assert(
    proof.identity?.sharedAuthenticationPlane === true,
    "Workspace proof lacks shared authentication",
  );
  assert(
    proof.identity?.livePostgresMembership === true,
    "Workspace proof lacks live membership checks",
  );
  assert(
    proof.identity?.revocationImmediate === true,
    "Workspace proof lacks immediate revocation",
  );
  assert(
    proof.identity?.sensitiveActionsRequireRecentAal2 === true,
    "Workspace proof lacks recent AAL2",
  );
  assert(
    proof.factory?.vortonInstallationIdNamed === true,
    "Factory proof lacks Vorton installation identity",
  );
  assert(
    proof.factory?.workspaceIdNamed === true,
    "Factory proof lacks workspace identity",
  );
  assert(
    proof.factory?.githubAppInstallationIdSeparatelyNamed === true,
    "Factory proof overloads installation identity",
  );
  assert(
    proof.factory?.currentPilotAcceptedAsProof === false,
    "Factory pilot was accepted as workspace proof",
  );
  assert(
    proof.authority?.rolesGrantAuthority === false,
    "Workspace proof lets roles grant authority",
  );
  assert(
    proof.authority?.policyCapabilitiesApprovalsAndWorkRequired === true,
    "Workspace proof lacks governed authority",
  );
  assert(
    proof.authority?.installationWorkspaceCreationApprovalPlane === true,
    "Workspace proof lacks an installation-scoped workspace creation approval plane",
  );
  assert(
    proof.authority?.runtimeRoleCanSetAuthClaims === false,
    "Workspace proof lets the runtime role set authentication claims",
  );
  assert(
    proof.authority?.workspaceCreationUsesSignedTransactionBoundary === true,
    "Workspace creation does not use a signed transaction boundary",
  );
  assert(
    proof.authority?.workspaceCreationApprovalConsumedExactlyOnce === true,
    "Workspace creation approval is not consumed exactly once",
  );
  assert(
    proof.authority?.workspaceCreationReceiptInsertedAtomically === true,
    "Workspace creation receipt is not inserted atomically",
  );
  assert(
    proof.authority?.existingWorkspaceAuthorityBorrowedForWorkspaceCreation ===
      false,
    "Workspace creation borrows authority from an existing workspace",
  );
  assert(Array.isArray(proof.claims), "Workspace proof claims are missing");
  for (const [index, claim] of proof.claims.entries()) {
    assertExactKeys(
      claim,
      ["id", "status", "adversarial", "evidenceSha256"],
      `Workspace proof claim ${index}`,
    );
  }
  assert(
    JSON.stringify(proof.claims.map((claim: { id?: unknown }) => claim?.id)) ===
      JSON.stringify(requiredWorkspaceClaims),
    "Workspace proof claim identity or order differs",
  );
  for (const claim of proof.claims) {
    assert(
      claim.status === "passed",
      `Workspace claim did not pass: ${claim.id}`,
    );
    assert(
      claim.adversarial === true,
      `Workspace claim is not adversarial: ${claim.id}`,
    );
    assert(
      digest(claim.evidenceSha256),
      `Workspace claim evidence digest is invalid: ${claim.id}`,
    );
  }
  assert(
    Array.isArray(proof.releaseBlockers),
    "Workspace release blockers are missing",
  );
  assert(
    proof.releaseBlockers.length === 0,
    "Workspace release still has blockers",
  );
  assert(digest(proof.proofHash), "Workspace proof hash is invalid");
  assert(
    proof.proofHash === workspaceProofHash(proof),
    "Workspace proof hash differs",
  );
  return proof as unknown as WorkspaceIsolationProof;
}

/**
 * Producer-side sanity check only. Release preparation independently verifies
 * the GitHub run and its immutable evidence artifact before accepting a proof.
 */
export function validateGitHubProducer(
  proof: WorkspaceIsolationProof,
  environment: NodeJS.ProcessEnv,
): void {
  assert(
    environment.GITHUB_ACTIONS === "true",
    "Workspace proof must be produced by GitHub Actions",
  );
  assert(
    environment.GITHUB_SHA === proof.sourceCommit,
    "GitHub workflow commit differs from workspace proof",
  );
  assert(
    proof.producer.workflowRunUrl ===
      `https://github.com/AubreyF/vorton/actions/runs/${environment.GITHUB_RUN_ID ?? ""}`,
    "GitHub workflow run differs from workspace proof",
  );
}
