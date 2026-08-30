import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  commandBridgeSections,
  commandSectionIdFromSubsection,
  sectionFromHash,
  subsectionFromHash,
} from "./AuthenticApp.js";
import { SectionNavigator } from "./design-system/section-navigator.js";
import {
  advanceCouncilUntilSettled,
  CouncilSurface,
  EXECUTIVE_COUNCIL_ROLES,
} from "./executive-council.js";
import {
  previewCouncilFailure,
  previewCouncilStates,
} from "./executive-council.preview.js";

const workItems = [
  {
    id: previewCouncilStates.complete.work.id,
    title: previewCouncilStates.complete.work.title,
    requestedOutcome: previewCouncilStates.complete.work.requestedOutcome,
    acceptanceCriteria: previewCouncilStates.complete.work.acceptanceCriteria,
    state: "ready" as const,
    priority: 90,
    parentWorkId: null,
    custodianName: "Council worker",
    custodianKind: "worker" as const,
    updatedAt: "2026-08-30T01:02:03.000Z",
  },
];

const evidence = [
  {
    id: "evidence-product-01",
    summary: "Current product evidence is bounded and synthetic.",
    classification: "synthetic",
  },
  {
    id: "evidence-market-02",
    summary: "No external action has owner authority.",
    classification: "synthetic",
  },
];

function renderCouncil(
  council = previewCouncilStates.complete,
  failure?: string,
  embedded = false,
) {
  return renderToStaticMarkup(
    <CouncilSurface
      installationName="FreedOS"
      installationKind="owner"
      workItems={workItems}
      selectedWorkId={workItems[0]!.id}
      evidence={evidence}
      council={council}
      loading={false}
      running={false}
      failure={failure}
      embedded={embedded}
      onSelectWork={() => undefined}
      onConvene={() => undefined}
    />,
  );
}

describe("executive council route and surface", () => {
  it("maps legacy Command Bridge hashes to sections on one page", () => {
    expect(sectionFromHash("#command/Council")).toBe("command");
    expect(subsectionFromHash("command", "#command/Council")).toBe("Council");
    expect(subsectionFromHash("command", "#command/unknown")).toBe("Briefing");
    expect(subsectionFromHash("tools", "#tools/moonbase-triage")).toBe(
      "moonbase-triage",
    );
    expect(subsectionFromHash("tools", "#tools/unknown")).toBe("Catalog");
    expect(commandSectionIdFromSubsection("Council")).toBe("command-council");
    expect(commandSectionIdFromSubsection("unknown")).toBe("command-briefing");
  });

  it("renders the AubOS section rail and compact fallback for all command sections", () => {
    const html = renderToStaticMarkup(
      <SectionNavigator
        items={commandBridgeSections}
        label="Command Bridge sections"
        requestedId="command-briefing"
        onNavigate={() => undefined}
      >
        {commandBridgeSections.map((section) => (
          <section id={section.id} key={section.id}>
            {section.label}
          </section>
        ))}
      </SectionNavigator>,
    );
    expect(html).toContain('class="section-navigator-rail"');
    expect(html).toContain(
      'class="section-navigator-mobile section-navigator-topbar"',
    );
    expect(html).toContain('href="#command/Council"');
    expect(html).toContain('id="command-decisions"');
    expect(html).toContain('id="command-activity"');
  });

  it("defines one unique skill for each required executive role", () => {
    expect(EXECUTIVE_COUNCIL_ROLES).toHaveLength(5);
    expect(new Set(EXECUTIVE_COUNCIL_ROLES).size).toBe(5);
    expect(EXECUTIVE_COUNCIL_ROLES).toEqual([
      "Chief Executive Officer",
      "Chief Marketing Officer",
      "Chief Technology Officer",
      "Chief Operating Officer",
      "Chief Financial Officer",
    ]);
  });

  it("renders recommendations, cross-review, explicit dissent, evidence IDs, and synthesis", () => {
    const html = renderCouncil();
    expect(html).toContain("Recommendations");
    expect(html).toContain("Cross-review");
    expect(html).toContain("Dissent recorded");
    expect(html).toContain("evidence-product-01");
    expect(html).toContain("Synthesis");
    expect(html).toContain(
      "Run one bounded evidence experiment with an owner-approved success measure",
    );
  });

  it("keeps a partial failure visible without manufacturing completion", () => {
    const html = renderCouncil(
      previewCouncilStates.partialFailure,
      previewCouncilFailure,
    );
    expect(html).toContain("Council paused");
    expect(html).toContain("Chief Technology Officer review call failed");
    expect(html).toContain("5 / 5");
    expect(html).toContain("2 / 5");
    expect(html).toContain("Synthesis is withheld");
    expect(html).not.toContain("Council record is complete");
  });

  it("states the authority boundary and exposes accessible governed controls", () => {
    const html = renderCouncil();
    expect(html).toContain("0 external actions authorized");
    expect(html).toContain('aria-label="Council agenda"');
    expect(html).toContain('aria-label="Council progress"');
    expect(html).toContain('aria-label="Council result views"');
    expect(html).toContain("Evidence and acceptance criteria");
    expect(html).toContain("Provenance and record IDs");
    expect(html).toContain("Review synthesis");
    expect(html).not.toMatch(/>Approve</);
    expect(html).not.toMatch(/>Execute</);
  });

  it("uses a section heading when the council is embedded in Command Bridge", () => {
    const html = renderCouncil(previewCouncilStates.complete, undefined, true);
    expect(html).toContain("<h2>Executive council</h2>");
    expect(html).not.toContain("<h1>Executive council</h1>");
  });
});

describe("bounded council advancement", () => {
  it("publishes each durable step and stops at complete", async () => {
    const states = [
      previewCouncilStates.recommendations,
      previewCouncilStates.partialFailure,
      previewCouncilStates.synthesis,
      previewCouncilStates.complete,
    ];
    const advance = vi.fn(async () => states.shift()!);
    const progress = vi.fn();
    const result = await advanceCouncilUntilSettled(
      previewCouncilStates.ready,
      advance,
      progress,
    );
    expect(result.phase).toBe("complete");
    expect(advance).toHaveBeenCalledTimes(4);
    expect(progress).toHaveBeenCalledTimes(4);
  });

  it("fails closed if a call returns no durable progress", async () => {
    await expect(
      advanceCouncilUntilSettled(
        previewCouncilStates.ready,
        async () => previewCouncilStates.ready,
        () => undefined,
      ),
    ).rejects.toThrow("no durable progress");
  });
});
