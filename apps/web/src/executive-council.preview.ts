import type {
  CouncilPhase,
  CouncilRecord,
  ExecutiveCouncilState,
} from "./runtime.js";

function previewUuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

export const previewCouncilScope = {
  installationId: previewUuid(2),
  workspaceId: previewUuid(10),
  workId: previewUuid(3),
  evidenceIds: [previewUuid(6), previewUuid(7)],
} as const;

const roleSeeds = [
  [previewUuid(101), previewUuid(201), "Chief Executive Officer"],
  [previewUuid(102), previewUuid(202), "Chief Marketing Officer"],
  [previewUuid(103), previewUuid(203), "Chief Technology Officer"],
  [previewUuid(104), previewUuid(204), "Chief Operating Officer"],
  [previewUuid(105), previewUuid(205), "Chief Financial Officer"],
] as const;

function recordId(
  phase: Exclude<CouncilPhase, "complete">,
  index: number,
): string {
  const offset = phase === "proposal" ? 301 : phase === "review" ? 311 : 321;
  return previewUuid(offset + index);
}

function record(
  roleId: string,
  workerId: string,
  phase: Exclude<CouncilPhase, "complete">,
  index: number,
  recommendation: string,
): CouncilRecord {
  return {
    id: recordId(phase, index),
    installationId: previewCouncilScope.installationId,
    workspaceId: previewCouncilScope.workspaceId,
    kind: phase === "review" ? "review" : "proposal",
    summary:
      phase === "proposal"
        ? `Independent recommendation ${String(index + 1)}`
        : phase === "review"
          ? `Cross-review ${String(index + 1)}`
          : "CEO synthesis",
    actorWorkerId: workerId,
    recommendation: {
      summary: recommendation,
      evidenceRecordIds: [...previewCouncilScope.evidenceIds],
      alternatives: [
        {
          title: "Preserve the current sequence",
          description: "Continue gathering evidence without expanding scope.",
          expectedOutcome: "A smaller decision surface with clearer evidence.",
          risks: ["The learning cycle may take longer."],
        },
      ],
      recommendedAction: {
        title: "Run one bounded evidence experiment",
        description: recommendation,
        capability: "executive.recommend",
        mode: "recommend",
        externalEffect: false,
      },
      confidence: 0.72,
      uncertainties:
        phase === "review" && index === 4
          ? ["Dissent remains on the launch cost ceiling."]
          : ["Owner judgment is still required."],
    },
    phase,
    roleId,
    inputRecordIds: [...previewCouncilScope.evidenceIds],
    peerRecordIds:
      phase === "review" || phase === "synthesis"
        ? roleSeeds.map((_, peerIndex) => recordId("proposal", peerIndex))
        : [],
    providerJob: {
      id: `job-${phase}-${String(index + 1)}`,
      provider: "preview",
      model: "synthetic",
      store: false,
      background: false,
    },
  };
}

const proposals = roleSeeds.map(([roleId, workerId], index) =>
  record(
    roleId,
    workerId,
    "proposal",
    index,
    [
      "Prioritize one bounded customer evidence experiment before expanding scope.",
      "Test a precise market narrative against the current launch audience.",
      "Protect the smallest reliable technical path and instrument the result.",
      "Sequence ownership and operating dependencies before promising a date.",
      "Cap the experiment and define the evidence required for further spend.",
    ][index]!,
  ),
);

const reviews = roleSeeds.map(([roleId, workerId], index) =>
  record(
    roleId,
    workerId,
    "review",
    index,
    index === 4
      ? "I dissent from expanding the launch experiment before its cost ceiling and stop condition are recorded."
      : "The recommendations are compatible if the owner chooses one measurable outcome and preserves the stated authority boundary.",
  ),
);

function stateAt(
  phase: ExecutiveCouncilState["phase"],
  proposalCount: number,
  reviewCount: number,
  includeSynthesis: boolean,
): ExecutiveCouncilState {
  const synthesis = includeSynthesis
    ? record(
        roleSeeds[0][0],
        roleSeeds[0][1],
        "synthesis",
        0,
        "Run one bounded evidence experiment with an owner-approved success measure, explicit cost ceiling, and no external publication authority.",
      )
    : null;
  const roles = roleSeeds.map(([roleId, workerId, name], index) => ({
    roleId,
    workerId,
    name,
    version: 1,
    status: (index >= proposalCount
      ? "awaiting_proposal"
      : index >= reviewCount
        ? "awaiting_review"
        : "complete") as ExecutiveCouncilState["roles"][number]["status"],
    proposal: index < proposalCount ? proposals[index]! : null,
    review: index < reviewCount ? reviews[index]! : null,
  }));
  const total = proposalCount + reviewCount + (synthesis ? 1 : 0);
  const nextStep =
    phase === "complete"
      ? null
      : phase === "proposal"
        ? {
            phase: "proposal" as const,
            roleId: roles[proposalCount]?.roleId ?? roleSeeds[0][0],
            roleName: roles[proposalCount]?.name ?? "Chief Executive Officer",
          }
        : phase === "review"
          ? {
              phase: "review" as const,
              roleId: roles[reviewCount]?.roleId ?? roleSeeds[0][0],
              roleName: roles[reviewCount]?.name ?? "Chief Executive Officer",
            }
          : {
              phase: "synthesis" as const,
              roleId: roleSeeds[0][0],
              roleName: "Chief Executive Officer",
            };
  return {
    protocol: "vorton.executive-council.v1",
    installationId: previewCouncilScope.installationId,
    workspaceId: previewCouncilScope.workspaceId,
    work: {
      id: previewCouncilScope.workId,
      title: "Choose the next product decision",
      requestedOutcome:
        "Select one decision that creates the most useful evidence for Freed.",
      acceptanceCriteria: [
        "The recommendation cites current evidence.",
        "The owner makes the consequential decision.",
      ],
      state: "ready",
    },
    authority: "none",
    phase,
    nextStep,
    counts: {
      proposals: proposalCount,
      reviews: reviewCount,
      syntheses: synthesis ? 1 : 0,
      total,
      required: 11,
    },
    roles,
    synthesis,
  };
}

export const previewCouncilStates = {
  ready: stateAt("proposal", 0, 0, false),
  recommendations: stateAt("review", 5, 0, false),
  partialFailure: stateAt("review", 5, 2, false),
  synthesis: stateAt("synthesis", 5, 5, false),
  complete: stateAt("complete", 5, 5, true),
} as const;

export const previewCouncilFailure =
  "The Chief Technology Officer review call failed before it produced a durable record.";
