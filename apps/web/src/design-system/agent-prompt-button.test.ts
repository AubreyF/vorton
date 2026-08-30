import { describe, expect, it } from "vitest";
import { buildAgentDialoguePrompt } from "./agent-prompt-button.js";

describe("agent dialogue prompt", () => {
  it("binds installation context and preserves the authority boundary", () => {
    const prompt = buildAgentDialoguePrompt({
      installationName: "FreedOS",
      kind: "work item",
      id: "work-synthetic-1",
      title: "Choose the next product decision",
      objective: "Recommend one decision",
      closureEvidence: "A reviewed outcome receipt",
      authorityBoundary: "A human must approve consequential action.",
    });

    expect(prompt).toContain("governed FreedOS work item");
    expect(prompt).toContain("Item ID: work-synthetic-1");
    expect(prompt).toContain("A human must approve consequential action.");
    expect(prompt).toContain("Copying this prompt grants no source access");
    expect(prompt).not.toContain("/Users/");
  });
});
