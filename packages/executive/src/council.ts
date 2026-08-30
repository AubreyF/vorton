import { createHash } from "node:crypto";

import {
  executiveCouncilStateSchema,
  type ExecutiveCouncilRecord,
  type ExecutiveCouncilState,
} from "@vorton/contracts";

export const executiveCouncilProtocol = "vorton.executive-council.v1" as const;

export interface CanonicalCouncilRole {
  slug:
    | "chief-executive-officer"
    | "chief-marketing-officer"
    | "chief-technology-officer"
    | "chief-operating-officer"
    | "chief-financial-officer";
  name:
    | "Chief Executive Officer"
    | "Chief Marketing Officer"
    | "Chief Technology Officer"
    | "Chief Operating Officer"
    | "Chief Financial Officer";
  version: 1;
  skillMarkdown: string;
  contentSha256: string;
}

function skill(
  name: CanonicalCouncilRole["name"],
  mandate: string,
  practices: readonly string[],
  prohibited: string,
): string {
  return `# ${name}\n\nVersion: 1\n\n## Mandate\n\n${mandate}\n\n## Practice\n\n${practices.map((practice) => `- ${practice}`).join("\n")}\n\n## Boundary\n\nThis role grants no authority. It may recommend${name === "Chief Executive Officer" ? ", cross-review, and synthesize" : " and cross-review"}. It may not decide, approve, create Work, invoke tools, ${prohibited}, or act externally.\n`;
}

function role(
  slug: CanonicalCouncilRole["slug"],
  name: CanonicalCouncilRole["name"],
  mandate: string,
  practices: readonly string[],
  prohibited: string,
): CanonicalCouncilRole {
  const skillMarkdown = skill(name, mandate, practices, prohibited);
  return {
    slug,
    name,
    version: 1,
    skillMarkdown,
    contentSha256: createHash("sha256").update(skillMarkdown).digest("hex"),
  };
}

export const canonicalCouncilRoles: readonly CanonicalCouncilRole[] = [
  role(
    "chief-executive-officer",
    "Chief Executive Officer",
    "Integrate organizational priorities into a coherent recommendation. Resolve neither policy nor authority. Make tradeoffs explicit across mission, customers, operations, technology, capital, and risk.",
    [
      "State the decision frame and the outcome that matters.",
      "Compare viable alternatives instead of defending a predetermined answer.",
      "Identify dependencies, sequencing, reversibility, and opportunity cost.",
      "Preserve material disagreement from other executive roles.",
      "For synthesis, distinguish agreement, disagreement, and required revision.",
    ],
    "spend, publish, contact anyone",
  ),
  role(
    "chief-marketing-officer",
    "Chief Marketing Officer",
    "Evaluate organizational choices through customer truth, positioning, distribution, trust, and measurable demand. Separate evidence from attractive marketing folklore.",
    [
      "Identify the audience, their problem, and the promised change.",
      "Test positioning, channel fit, message credibility, and measurement.",
      "Surface reputational risk and unsupported market assumptions.",
      "Compare near-term demand creation with durable brand value.",
      "In cross-review, state agreement, disagreement, and required revision.",
    ],
    "spend, publish, contact anyone",
  ),
  role(
    "chief-technology-officer",
    "Chief Technology Officer",
    "Evaluate technical feasibility, architecture, security, reliability, delivery sequence, and long-term operating cost. Prefer the smallest complete system that preserves future options.",
    [
      "Identify technical constraints, dependencies, and failure modes.",
      "Distinguish reversible experiments from durable architecture.",
      "Assess security, data boundaries, observability, and recovery.",
      "Make build, buy, integrate, and defer tradeoffs explicit.",
      "In cross-review, state agreement, disagreement, and required revision.",
    ],
    "change software, publish",
  ),
  role(
    "chief-operating-officer",
    "Chief Operating Officer",
    "Evaluate execution reality: ownership, process, sequencing, capacity, quality controls, dependencies, and recoverability. Turn strategy into a bounded operating recommendation without claiming execution authority.",
    [
      "Identify the critical path, handoffs, gates, and completion evidence.",
      "Surface staffing, coordination, and operational bottlenecks.",
      "Require explicit rollback, incident, and recovery considerations.",
      "Distinguish activity from a verifiable outcome.",
      "In cross-review, state agreement, disagreement, and required revision.",
    ],
    "assign people, publish",
  ),
  role(
    "chief-financial-officer",
    "Chief Financial Officer",
    "Evaluate capital allocation, cash exposure, unit economics, downside, optionality, and measurement. Treat missing numbers as uncertainty, never permission to invent them.",
    [
      "Identify direct cost, opportunity cost, and downside exposure.",
      "Separate known figures, estimates, and assumptions.",
      "Compare expected value, reversibility, and time to evidence.",
      "Require budget, limit, and stop conditions where material.",
      "In cross-review, state agreement, disagreement, and required revision.",
    ],
    "spend, publish",
  ),
] as const;

export interface InstalledCouncilRole {
  roleId: string;
  workerId: string;
  name: string;
  version: number;
}

export interface CouncilWorkSnapshot {
  id: string;
  title: string;
  requestedOutcome: string;
  acceptanceCriteria: string[];
  state: ExecutiveCouncilState["work"]["state"];
}

export function deriveCouncilState(input: {
  installationId: string;
  work: CouncilWorkSnapshot;
  roles: InstalledCouncilRole[];
  records: ExecutiveCouncilRecord[];
}): ExecutiveCouncilState {
  if (input.roles.length !== canonicalCouncilRoles.length) {
    throw new Error("Executive council installation is incomplete");
  }
  const proposals = input.records.filter(
    (record) => record.phase === "proposal",
  );
  const reviews = input.records.filter((record) => record.phase === "review");
  const syntheses = input.records.filter(
    (record) => record.phase === "synthesis",
  );
  const nextProposal = input.roles.find(
    (candidate) =>
      !proposals.some((record) => record.roleId === candidate.roleId),
  );
  const nextReview = input.roles.find(
    (candidate) =>
      !reviews.some((record) => record.roleId === candidate.roleId),
  );
  const chiefExecutive = input.roles.find(
    (candidate) => candidate.name === "Chief Executive Officer",
  );
  if (!chiefExecutive) {
    throw new Error("Executive council has no Chief Executive Officer role");
  }
  const nextStep = nextProposal
    ? {
        phase: "proposal" as const,
        roleId: nextProposal.roleId,
        roleName: nextProposal.name,
      }
    : nextReview
      ? {
          phase: "review" as const,
          roleId: nextReview.roleId,
          roleName: nextReview.name,
        }
      : syntheses.length === 0
        ? {
            phase: "synthesis" as const,
            roleId: chiefExecutive.roleId,
            roleName: chiefExecutive.name,
          }
        : null;
  const phase = nextProposal
    ? "proposal"
    : nextReview
      ? "review"
      : syntheses.length === 0
        ? "synthesis"
        : "complete";
  return executiveCouncilStateSchema.parse({
    protocol: executiveCouncilProtocol,
    installationId: input.installationId,
    work: input.work,
    authority: "none",
    phase,
    nextStep,
    counts: {
      proposals: proposals.length,
      reviews: reviews.length,
      syntheses: syntheses.length,
      total: proposals.length + reviews.length + syntheses.length,
      required: 11,
    },
    roles: input.roles.map((candidate) => {
      const proposal =
        proposals.find((record) => record.roleId === candidate.roleId) ?? null;
      const review =
        reviews.find((record) => record.roleId === candidate.roleId) ?? null;
      return {
        ...candidate,
        status: !proposal
          ? "awaiting_proposal"
          : !review
            ? "awaiting_review"
            : "complete",
        proposal,
        review,
      };
    }),
    synthesis: syntheses[0] ?? null,
  });
}
