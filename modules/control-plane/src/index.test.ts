import { describe, expect, it } from "vitest";
import { createSyntheticControlPlaneDataSource } from "./index.js";

describe("synthetic control-plane adapter", () => {
  it("keeps upstream Tools completely blank", async () => {
    const source = createSyntheticControlPlaneDataSource();
    const first = await source.getSnapshot();
    const second = await source.getSnapshot();
    expect(first.installedTools).toEqual([]);
    expect(
      first.modules.find((module) => module.id === "tools")?.countLabel,
    ).toBe("0 installed");
    expect(second).not.toBe(first);
  });

  it("includes Factory in the first-party module registry", async () => {
    const snapshot =
      await createSyntheticControlPlaneDataSource().getSnapshot();
    expect(snapshot.modules.map((module) => module.id)).toContain("factory");
    expect(snapshot.modules.map((module) => module.id)).not.toContain(
      "finance",
    );
    expect(snapshot.modules.map((module) => module.id)).not.toContain(
      "conversations",
    );
    expect(snapshot.modules.map((module) => module.id)).toContain("admin");
    expect(snapshot.modules).toHaveLength(7);
  });

  it("creates inspectable Work inside the synthetic adapter boundary", async () => {
    const source = createSyntheticControlPlaneDataSource();
    const created = await source.createWork({
      title: "Inspect the synthetic relay",
      module: "Factory",
    });
    const snapshot = await source.getSnapshot();
    expect(created).toMatchObject({
      id: "WORK-105",
      state: "proposed",
      owner: "Unassigned",
    });
    expect(snapshot.work[0]).toEqual(created);
  });

  it("exposes executive stage and authority separately", async () => {
    const snapshot =
      await createSyntheticControlPlaneDataSource().getSnapshot();
    expect(snapshot.executiveWorkflows[0]).toMatchObject({
      stage: "review",
      authority: "none",
      provider: "deterministic-fake",
    });
  });
});
