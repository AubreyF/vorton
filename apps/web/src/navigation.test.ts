import { describe, expect, it } from "vitest";
import { isPageId, moduleNav } from "./navigation.js";

describe("module navigation", () => {
  it("keeps Factory inside the first-party module rail", () => {
    expect(moduleNav.at(-1)?.id).toBe("factory");
    expect(moduleNav).toHaveLength(9);
    expect(isPageId("factory")).toBe(true);
    expect(isPageId("factory-system")).toBe(false);
  });
});
