import type { InstallationRealm } from "@vorton/contracts";

export type HindsightBank = {
  id: string;
  installationId: string;
  workspaceId: string;
  realm: InstallationRealm;
};

const canonicalUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function requiredIdentity(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  if (!canonicalUuid.test(value)) {
    throw new Error(`${label} must be a lowercase canonical UUID`);
  }
  return value;
}

/** One deterministic Hindsight routing identity per workspace and realm. */
export function workspaceHindsightBank(
  installationId: string,
  workspaceId: string,
  realm: InstallationRealm,
): HindsightBank {
  if (realm !== "personal" && realm !== "organizational") {
    throw new Error("Hindsight bank realm is invalid");
  }
  const canonicalInstallationId = requiredIdentity(
    installationId,
    "Installation ID",
  );
  const canonicalWorkspaceId = requiredIdentity(workspaceId, "Workspace ID");
  return {
    id: `${realm}:${canonicalInstallationId}:${canonicalWorkspaceId}:default`,
    installationId: canonicalInstallationId,
    workspaceId: canonicalWorkspaceId,
    realm,
  };
}

export function assertHindsightBank(bank: HindsightBank): void {
  const canonical = workspaceHindsightBank(
    bank.installationId,
    bank.workspaceId,
    bank.realm,
  );
  if (bank.id !== canonical.id) {
    throw new Error(
      "Hindsight bank identity does not match its installation, workspace, and realm",
    );
  }
}
