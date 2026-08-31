import { describe, expect, it } from "vitest";

import { InMemoryHindsightAdapter, workspaceHindsightBank } from "./index.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const workspaceId = "c07905c2-656e-43e3-a130-fd1429964caa";
const personal = workspaceHindsightBank(
  installationId,
  workspaceId,
  "personal",
);

describe("Hindsight adapter isolation", () => {
  it("derives one lineage-qualified bank for an installation workspace realm", () => {
    expect(
      workspaceHindsightBank(installationId, workspaceId, "organizational"),
    ).toEqual({
      id: `organizational:${installationId}:${workspaceId}:lineage-v2`,
      installationId,
      workspaceId,
      realm: "organizational",
    });
  });

  it("rejects the legacy default bank identity", async () => {
    const adapter = new InMemoryHindsightAdapter();
    await expect(
      adapter.ensureBank({
        ...personal,
        id: `personal:${installationId}:${workspaceId}:default`,
      }),
    ).rejects.toThrow("does not match");
  });

  it("requires injective lowercase canonical UUID components", () => {
    expect(() =>
      workspaceHindsightBank(
        installationId.toUpperCase(),
        workspaceId,
        "personal",
      ),
    ).toThrow("lowercase canonical UUID");
    expect(() =>
      workspaceHindsightBank(installationId, "workspace:forged", "personal"),
    ).toThrow("lowercase canonical UUID");
  });

  it("does not allow a bank identity to cross realms", async () => {
    const adapter = new InMemoryHindsightAdapter();
    await expect(
      adapter.ensureBank({ ...personal, realm: "organizational" }),
    ).rejects.toThrow("does not match");
  });

  it("requires the exact canonical bank identity", async () => {
    const adapter = new InMemoryHindsightAdapter();
    await expect(
      adapter.ensureBank({ ...personal, id: `${personal.id}:grafted` }),
    ).rejects.toThrow("does not match");
    await expect(
      adapter.ensureBank({
        ...personal,
        workspaceId: "8af0569c-1eba-4b2e-97c2-c12570208531",
      }),
    ).rejects.toThrow("does not match");
  });

  it("never recalls derived memory across installation banks", async () => {
    const adapter = new InMemoryHindsightAdapter();
    const otherInstallationId = "a037f814-3572-4dcb-8a56-f2968c22bdcf";
    const other = workspaceHindsightBank(
      otherInstallationId,
      workspaceId,
      "personal",
    );
    await adapter.retain(other, {
      id: "other-memory",
      text: "Synthetic lunar planning note",
      classification: "synthetic",
      citations: [],
      sourceRevisionIds: ["other-source"],
      invalidatedAt: null,
    });
    await expect(adapter.retrieve(personal, "lunar")).resolves.toEqual([]);
  });

  it("never recalls derived memory across same-realm workspaces", async () => {
    const adapter = new InMemoryHindsightAdapter();
    const other = workspaceHindsightBank(
      installationId,
      "8af0569c-1eba-4b2e-97c2-c12570208531",
      "personal",
    );
    expect(other.id).not.toBe(personal.id);
    expect(other.id).toBe(
      `personal:${installationId}:8af0569c-1eba-4b2e-97c2-c12570208531:lineage-v2`,
    );
    await adapter.retain(other, {
      id: "other-workspace-memory",
      text: "Synthetic private workspace note",
      classification: "synthetic",
      citations: [],
      sourceRevisionIds: ["other-source"],
      invalidatedAt: null,
    });
    await expect(adapter.retrieve(personal, "private")).resolves.toEqual([]);
  });

  it("invalidates every derived memory with deleted lineage", async () => {
    const adapter = new InMemoryHindsightAdapter();
    await adapter.retain(personal, {
      id: "memory-1",
      text: "Synthetic lunar planning note",
      classification: "synthetic",
      citations: [],
      sourceRevisionIds: ["source-1"],
      invalidatedAt: null,
    });
    await adapter.invalidateSource(
      personal,
      "source-1",
      "2026-08-28T12:00:00.000Z",
    );
    await expect(adapter.retrieve(personal, "lunar")).resolves.toEqual([]);
  });
});
