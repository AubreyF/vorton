import { describe, expect, it } from "vitest";

import {
  InMemoryHindsightAdapter,
  installationHindsightBank,
  type HindsightBank,
} from "./index.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const personal: HindsightBank = {
  id: `personal:${installationId}:default`,
  installationId,
  realm: "personal",
};

describe("Hindsight adapter isolation", () => {
  it("derives one canonical default bank for an installation realm", () => {
    expect(installationHindsightBank(installationId, "organizational")).toEqual(
      {
        id: `organizational:${installationId}:default`,
        installationId,
        realm: "organizational",
      },
    );
  });

  it("does not allow a bank identity to cross realms", async () => {
    const adapter = new InMemoryHindsightAdapter();
    await expect(
      adapter.ensureBank({ ...personal, realm: "organizational" }),
    ).rejects.toThrow("does not match");
  });

  it("never recalls derived memory across installation banks", async () => {
    const adapter = new InMemoryHindsightAdapter();
    const otherInstallationId = "a037f814-3572-4dcb-8a56-f2968c22bdcf";
    const other: HindsightBank = {
      id: `personal:${otherInstallationId}:default`,
      installationId: otherInstallationId,
      realm: "personal",
    };
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
