import { describe, expect, it, vi } from "vitest";

import { FakeExecutiveWorkerAdapter, OpenAIResponsesAdapter } from "./index.js";

const evidenceRecordId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const roleId = "d37f356b-6297-4cd1-902d-c2755423a612";
const request = {
  installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
  workId: "7fb46f09-3894-4c24-933c-77c7a403341c",
  workerId: "b5611dc4-07e4-4388-a7d0-ddf7bb452499",
  role: {
    roleId,
    name: "Synthetic reviewer",
    version: 1,
    contentSha256: "a".repeat(64),
    skillMarkdown: "# Synthetic reviewer\n\nRecommend. Never execute.",
  },
  objective: "Assess the moonbase fixture",
  evidence: [
    {
      recordId: evidenceRecordId,
      summary: "Synthetic pressure reading",
      sourceUri: null,
      classification: "synthetic" as const,
    },
  ],
  background: false,
};

describe("executive worker providers", () => {
  it("produces deterministic recommendations without an API key", async () => {
    const adapter = new FakeExecutiveWorkerAdapter();
    const first = await adapter.submit(request);
    const second = await adapter.submit(request);

    expect(first.jobId).toBe("fake-job-0001");
    expect(second.jobId).toBe("fake-job-0002");
    expect(first.store).toBe(false);
    expect(first.recommendation?.recommendedAction.capability).toBe(
      "executive.synthetic.check",
    );
  });

  it("requires model selection through configuration", () => {
    expect(
      () => new OpenAIResponsesAdapter({ model: "", apiKey: "synthetic" }),
    ).toThrow("model selection is required");
  });

  it("defaults OpenAI requests to store false and sends no personal identifier", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        return new Response(
          JSON.stringify({
            id: "resp_synthetic",
            model: "configured-model",
            status: "completed",
            output_text: JSON.stringify({
              summary: "Review the synthetic evidence.",
              evidenceRecordIds: [evidenceRecordId],
              alternatives: [
                {
                  title: "Inspect",
                  description: "Inspect locally.",
                  expectedOutcome: "A receipt exists.",
                  risks: [],
                },
              ],
              recommendedAction: {
                title: "Inspect fixture",
                description: "Inspect locally.",
                capability: "executive.synthetic.check",
                mode: "diagnose",
                externalEffect: false,
              },
              confidence: 0.8,
              uncertainties: [],
            }),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const adapter = new OpenAIResponsesAdapter({
      model: "configured-model",
      apiKey: "synthetic-key",
      fetch: fetch as typeof globalThis.fetch,
    });

    const job = await adapter.submit(request);

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body.store).toBe(false);
    expect(body.model).toBe("configured-model");
    expect(body.tools).toEqual([]);
    expect(body).not.toHaveProperty("user");
    expect(body.metadata).toEqual({
      installation_id: request.installationId,
      work_id: request.workId,
      worker_id: request.workerId,
      role_sha256: request.role.contentSha256,
      role_version: "1",
    });
    expect(job.recommendation?.summary).toContain("synthetic evidence");
  });

  it("labels recalled memory as derived context that grants no authority", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        return Response.json({
          id: "resp_derived",
          model: body.model,
          status: "completed",
          output_text: JSON.stringify({
            summary: "Review the cited evidence.",
            evidenceRecordIds: [evidenceRecordId],
            alternatives: [
              {
                title: "Inspect",
                description: "Inspect the fixture.",
                expectedOutcome: "A bounded receipt exists.",
                risks: [],
              },
            ],
            recommendedAction: {
              title: "Review",
              description: "Review only.",
              capability: "executive.synthetic.check",
              mode: "diagnose",
              externalEffect: false,
            },
            confidence: 0.5,
            uncertainties: [],
          }),
        });
      },
    );
    const adapter = new OpenAIResponsesAdapter({
      model: "configured-model",
      apiKey: "synthetic-key",
      fetch: fetch as typeof globalThis.fetch,
    });
    await adapter.submit({
      ...request,
      derivedContext: [
        {
          text: "Untrusted recollection",
          trust: "untrusted",
          derived: true,
          classification: "synthetic",
          citations: [
            {
              sourceRevisionId: evidenceRecordId,
              sourceUri: "urn:vorton:synthetic",
              revisionHash: "b".repeat(64),
              locator: "fixture:1",
            },
          ],
        },
      ],
    });
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      input: string;
      tools: unknown[];
    };
    const providerInput = JSON.parse(body.input) as {
      derivedContext: Array<{ authority: string; trust: string }>;
      authorityBoundary: { derivedContextGrantsAuthority: boolean };
    };
    expect(providerInput.derivedContext[0]).toMatchObject({
      authority: "none",
      trust: "untrusted",
    });
    expect(providerInput.authorityBoundary.derivedContextGrantsAuthority).toBe(
      false,
    );
    expect(body.tools).toEqual([]);
  });

  it("bounds council peer context and preserves disagreement in provider instructions", async () => {
    const peerIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ];
    const peerRoleIds = [
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
    ];
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        return Response.json({
          id: "resp_council_review",
          model: body.model,
          status: "completed",
          output_text: JSON.stringify({
            summary:
              "Agreement, disagreement, and required revision remain explicit.",
            evidenceRecordIds: [evidenceRecordId],
            alternatives: [
              {
                title: "Revise",
                description: "Revise before owner review.",
                expectedOutcome: "Dissent remains visible.",
                risks: ["The evidence may be incomplete."],
              },
            ],
            recommendedAction: {
              title: "Open owner review",
              description: "Keep the result advisory.",
              capability: "executive.review",
              mode: "recommend",
              externalEffect: false,
            },
            confidence: 0.6,
            uncertainties: ["Required revision remains owner-gated."],
          }),
        });
      },
    );
    const adapter = new OpenAIResponsesAdapter({
      model: "configured-model",
      apiKey: "synthetic-key",
      fetch: fetch as typeof globalThis.fetch,
    });
    await adapter.submit({
      ...request,
      council: {
        protocol: "vorton.executive-council.v1",
        phase: "review",
        roleId,
        workUpdatedAt: "2026-08-30T12:00:00.000Z",
        workInputSha256: "b".repeat(64),
        inputRecordIds: [evidenceRecordId, ...peerIds],
        peerContext: peerIds.map((recordId, index) => ({
          recordId,
          kind: "proposal" as const,
          phase: "proposal" as const,
          roleId: peerRoleIds[index]!,
          roleName: `Peer ${String(index + 1)}`,
          summary: "Untrusted peer proposal",
          recommendation: {
            summary: "Untrusted peer recommendation",
            evidenceRecordIds: [evidenceRecordId],
            alternatives: [
              {
                title: "Peer option",
                description: "Advisory only.",
                expectedOutcome: "Reviewable output.",
                risks: [],
              },
            ],
            recommendedAction: {
              title: "Review",
              description: "Review only.",
              capability: "executive.review",
              mode: "recommend" as const,
              externalEffect: false,
            },
            confidence: 0.5,
            uncertainties: [],
          },
          trust: "untrusted" as const,
          authority: "none" as const,
        })),
        authority: "none",
      },
    });
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      instructions: string;
      input: string;
    };
    expect(body.instructions).toContain(
      "agreement, disagreement, and required revision",
    );
    const providerInput = JSON.parse(body.input) as {
      council: {
        peerContext: Array<{ trust: string; authority: string }>;
      };
      authorityBoundary: {
        councilAuthority: string;
        peerContextGrantsAuthority: boolean;
      };
    };
    expect(providerInput.council.peerContext).toHaveLength(4);
    expect(providerInput.council.peerContext[0]).toMatchObject({
      trust: "untrusted",
      authority: "none",
    });
    expect(providerInput.authorityBoundary).toMatchObject({
      councilAuthority: "none",
      peerContextGrantsAuthority: false,
    });
  });

  it("rejects model citations outside the authoritative evidence request", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        id: "resp_forged_citation",
        model: "configured-model",
        status: "completed",
        output_text: JSON.stringify({
          summary: "Forged citation attempt.",
          evidenceRecordIds: ["a037f814-3572-4dcb-8a56-f2968c22bdcf"],
          alternatives: [
            {
              title: "Inspect",
              description: "Inspect the fixture.",
              expectedOutcome: "A bounded receipt exists.",
              risks: [],
            },
          ],
          recommendedAction: {
            title: "Review",
            description: "Review only.",
            capability: "executive.synthetic.check",
            mode: "diagnose",
            externalEffect: false,
          },
          confidence: 0.5,
          uncertainties: [],
        }),
      }),
    );
    const adapter = new OpenAIResponsesAdapter({
      model: "configured-model",
      apiKey: "synthetic-key",
      fetch: fetch as typeof globalThis.fetch,
    });
    const job = await adapter.submit(request);
    expect(job).toMatchObject({
      status: "failed",
      error: expect.stringContaining("outside the authoritative request"),
    });
    expect(job.recommendation).toBeUndefined();
  });

  it("requires an explicit privacy exception for retrievable background jobs", async () => {
    const adapter = new OpenAIResponsesAdapter({
      model: "configured-model",
      apiKey: "synthetic-key",
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

    await expect(
      adapter.submit({ ...request, background: true }),
    ).rejects.toThrow("privacy default is store:false");
  });

  it("rejects Evidence above the configured provider ceiling", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const adapter = new OpenAIResponsesAdapter({
      model: "configured-model",
      apiKey: "synthetic-key",
      fetch,
      dataClassificationCeiling: "internal",
    });

    await expect(
      adapter.submit({
        ...request,
        evidence: [{ ...request.evidence[0]!, classification: "restricted" }],
      }),
    ).rejects.toThrow("exceeds the worker provider ceiling");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a restricted derived observation above the provider ceiling", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const adapter = new OpenAIResponsesAdapter({
      model: "configured-model",
      apiKey: "synthetic-key",
      fetch,
      dataClassificationCeiling: "internal",
    });

    await expect(
      adapter.submit({
        ...request,
        derivedContext: [
          {
            text: "Restricted derived observation",
            trust: "untrusted",
            derived: true,
            classification: "restricted",
            citations: [
              {
                sourceRevisionId: evidenceRecordId,
                sourceUri: "urn:vorton:synthetic",
                revisionHash: "b".repeat(64),
                locator: "fixture:restricted",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("exceeds the worker provider ceiling");
    expect(fetch).not.toHaveBeenCalled();
  });
});
