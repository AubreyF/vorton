import { describe, expect, it } from "vitest";
import { moonbaseIncidents, triageMoonbaseIncidents } from "./index.js";

describe("Moonbase Triage", () => {
  it("produces a deterministic order without mutating the fixture", () => {
    const original = structuredClone(moonbaseIncidents);
    const first = triageMoonbaseIncidents(moonbaseIncidents);
    const second = triageMoonbaseIncidents(moonbaseIncidents);
    expect(first).toEqual(second);
    expect(first.map((incident) => incident.id)).toEqual([
      "MB-07",
      "MB-22",
      "MB-12",
      "MB-19",
    ]);
    expect(moonbaseIncidents).toEqual(original);
  });
});
