import { describe, expect, it } from "vitest";

import { InMemoryHindsightAdapter, type HindsightBank } from "./index.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const personal: HindsightBank = {
  id: `personal:${installationId}:default`,
  installationId,
  realm: "personal",
};

describe("Hindsight adapter isolation", () => {
  it("does not allow a bank identity to cross realms", async () => {
    const adapter = new InMemoryHindsightAdapter();
    await expect(
      adapter.ensureBank({ ...personal, realm: "organizational" }),
    ).rejects.toThrow("does not match");
  });

  it("invalidates every derived memory with deleted lineage", async () => {
    const adapter = new InMemoryHindsightAdapter();
    await adapter.retain(personal, {
      id: "memory-1",
      text: "Synthetic lunar planning note",
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
