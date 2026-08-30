import type {
  CouncilPhase,
  CouncilRecord,
  ExecutiveCouncilState,
} from "./runtime.js";

const roleSeeds = [
  ["role-ceo", "worker-ceo", "Chief Executive Officer"],
  ["role-cmo", "worker-cmo", "Chief Marketing Officer"],
  ["role-cto", "worker-cto", "Chief Technology Officer"],
  ["role-coo", "worker-coo", "Chief Operating Officer"],
  ["role-cfo", "worker-cfo", "Chief Financial Officer"],
] as const;

function record(
  roleId: string,
  workerId: string,
  phase: Exclude<CouncilPhase, "complete">,
  index: number,
  recommendation: string,
): CouncilRecord {
  return {
    id: `record-${phase}-${String(index + 1)}`,
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
      evidenceRecordIds: ["evidence-product-01", "evidence-market-02"],
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
    inputRecordIds: ["evidence-product-01", "evidence-market-02"],
    peerRecordIds:
      phase === "review" || phase === "synthesis"
        ? roleSeeds.map(
            (_, peerIndex) => `record-proposal-${String(peerIndex + 1)}`,
          )
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
        "role-ceo",
        "worker-ceo",
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
            roleId: roles[proposalCount]?.roleId ?? "role-ceo",
            roleName: roles[proposalCount]?.name ?? "Chief Executive Officer",
          }
        : phase === "review"
          ? {
              phase: "review" as const,
              roleId: roles[reviewCount]?.roleId ?? "role-ceo",
              roleName: roles[reviewCount]?.name ?? "Chief Executive Officer",
            }
          : {
              phase: "synthesis" as const,
              roleId: "role-ceo",
              roleName: "Chief Executive Officer",
            };
  return {
    protocol: "vorton.executive-council.v1",
    installationId: "00000000-0000-4000-8000-000000000002",
    work: {
      id: "00000000-0000-4000-8000-000000000003",
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
