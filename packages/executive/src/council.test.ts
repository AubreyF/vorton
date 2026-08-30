import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import type { ExecutiveCouncilRecord } from "@vorton/contracts";

import {
  canonicalCouncilRoles,
  deriveCouncilState,
  executiveCouncilProtocol,
} from "./council.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const workId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const workerId = "b5611dc4-07e4-4388-a7d0-ddf7bb452499";
const evidenceId = "4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8";
const roleIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

const roles = canonicalCouncilRoles.map((role, index) => ({
  roleId: roleIds[index]!,
  workerId,
  name: role.name,
  version: role.version,
}));

const work = {
  id: workId,
  title: "Set the synthetic operating priority",
  requestedOutcome: "Produce one reviewable council synthesis",
  acceptanceCriteria: ["Preserve dissent"],
  state: "ready" as const,
};

function record(
  phase: ExecutiveCouncilRecord["phase"],
  roleIndex: number,
  sequence: number,
  peers: string[] = [],
): ExecutiveCouncilRecord {
  const id = `${String(sequence).padStart(8, "0")}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  return {
    id,
    kind: phase === "review" ? "review" : "proposal",
    summary: `${phase} from ${roles[roleIndex]!.name}`,
    actorWorkerId: workerId,
    recommendation: {
      summary: "Agreement, disagreement, and required revision are explicit.",
      evidenceRecordIds: [evidenceId],
      alternatives: [
        {
          title: "Bounded option",
          description: "Remain advisory.",
          expectedOutcome: "A reviewable recommendation.",
          risks: ["Evidence may be incomplete."],
        },
      ],
      recommendedAction: {
        title: "Open owner review",
        description: "Ask the owner to review the recommendation.",
        capability: "executive.review",
        mode: "recommend",
        externalEffect: false,
      },
      confidence: 0.7,
      uncertainties: ["No external sources were consulted."],
    },
    phase,
    roleId: roles[roleIndex]!.roleId,
    inputRecordIds: [evidenceId, ...peers],
    peerRecordIds: peers,
    providerJob: {
      id: `job-${sequence}`,
      provider: "deterministic-fake",
      model: "synthetic-executive-v1",
      store: false,
      background: false,
    },
  };
}

describe("executive council protocol", () => {
  it("ships five canonical versioned skill files that exactly match runtime content", async () => {
    expect(executiveCouncilProtocol).toBe("vorton.executive-council.v1");
    expect(canonicalCouncilRoles.map((role) => role.name)).toEqual([
      "Chief Executive Officer",
      "Chief Marketing Officer",
      "Chief Technology Officer",
      "Chief Operating Officer",
      "Chief Financial Officer",
    ]);
    for (const role of canonicalCouncilRoles) {
      const source = await readFile(
        new URL(`../roles/${role.slug}/SKILL.md`, import.meta.url),
        "utf8",
      );
      expect(source).toBe(role.skillMarkdown);
      expect(role.contentSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source).toContain("This role grants no authority");
    }
  });

  it("derives exactly five proposals, five reviews, and one CEO synthesis", () => {
    const proposals = roles.map((_role, index) =>
      record("proposal", index, index + 1),
    );
    const reviews = roles.map((_role, index) =>
      record(
        "review",
        index,
        index + 6,
        proposals
          .filter((proposal) => proposal.roleId !== roles[index]!.roleId)
          .map((proposal) => proposal.id),
      ),
    );
    const synthesis = record(
      "synthesis",
      0,
      11,
      [...proposals, ...reviews].map((item) => item.id),
    );

    expect(
      deriveCouncilState({ installationId, work, roles, records: [] }),
    ).toMatchObject({
      phase: "proposal",
      nextStep: { phase: "proposal", roleName: "Chief Executive Officer" },
      counts: {
        proposals: 0,
        reviews: 0,
        syntheses: 0,
        total: 0,
        required: 11,
      },
      authority: "none",
    });
    expect(
      deriveCouncilState({ installationId, work, roles, records: proposals }),
    ).toMatchObject({
      phase: "review",
      nextStep: { phase: "review", roleName: "Chief Executive Officer" },
      counts: { proposals: 5, reviews: 0, total: 5 },
    });
    expect(
      deriveCouncilState({
        installationId,
        work,
        roles,
        records: [...proposals, ...reviews],
      }),
    ).toMatchObject({
      phase: "synthesis",
      nextStep: { phase: "synthesis", roleName: "Chief Executive Officer" },
      counts: { proposals: 5, reviews: 5, syntheses: 0, total: 10 },
    });
    expect(
      deriveCouncilState({
        installationId,
        work,
        roles,
        records: [...proposals, ...reviews, synthesis],
      }),
    ).toMatchObject({
      phase: "complete",
      nextStep: null,
      counts: { proposals: 5, reviews: 5, syntheses: 1, total: 11 },
      synthesis: { roleId: roles[0]!.roleId },
      authority: "none",
    });
  });
});
