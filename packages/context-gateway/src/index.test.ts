import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  InMemoryHindsightAdapter,
  type HindsightAdapter,
  type HindsightBank,
  type HindsightMemory,
  workspaceHindsightBank,
} from "@vorton/memory";
import {
  ContextGateway,
  type MemoryAuthorityContext,
  type MemoryBankAuthorityRequest,
  type MemoryBankAuthorityResolver,
  type ResolvedMemoryBankAuthority,
} from "./index.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherWorkspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const firstId = "11111111-1111-4111-a111-111111111111";
const secondId = "22222222-2222-4222-a222-222222222222";
const revisionHash = "a".repeat(64);
const principalId = "66666666-6666-4666-a666-666666666666";
const capabilityGrantId = "77777777-7777-4777-a777-777777777777";
const clock = { now: () => "2026-08-28T12:00:00.000Z" };
const authority: MemoryAuthorityContext = {
  workId: "55555555-5555-4555-a555-555555555555",
};

function revisionHashFor(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type SyntheticResolution =
  | HindsightBank
  | (Pick<ResolvedMemoryBankAuthority, "bank" | "dataClassificationCeiling"> &
      Partial<
        Omit<ResolvedMemoryBankAuthority, "bank" | "dataClassificationCeiling">
      >);

function completeSyntheticResolution(
  request: MemoryBankAuthorityRequest,
  resolution: SyntheticResolution,
): ResolvedMemoryBankAuthority {
  const authority =
    request.operation === "retrieve"
      ? { capability: "memory.retrieve", capabilityMode: "observe" as const }
      : {
          capability: `memory.${request.operation}`,
          capabilityMode: "modify" as const,
        };
  const partial = "bank" in resolution ? resolution : { bank: resolution };
  return {
    principalKind: "person",
    principalId,
    contextSubjectId: principalId,
    capabilityGrantId,
    ...authority,
    dataClassificationCeiling: "restricted",
    ...partial,
  };
}

class SyntheticAuthorityResolver implements MemoryBankAuthorityResolver {
  readonly requests: MemoryBankAuthorityRequest[] = [];
  readonly #resolve: (
    request: MemoryBankAuthorityRequest,
    call: number,
  ) => Promise<SyntheticResolution> | SyntheticResolution;

  constructor(
    resolve: (
      request: MemoryBankAuthorityRequest,
      call: number,
    ) => Promise<SyntheticResolution> | SyntheticResolution = (request) =>
      workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      ),
  ) {
    this.#resolve = resolve;
  }

  async resolve(
    request: MemoryBankAuthorityRequest,
  ): Promise<ResolvedMemoryBankAuthority> {
    const captured = structuredClone(request);
    this.requests.push(captured);
    const resolution = await this.#resolve(captured, this.requests.length);
    return completeSyntheticResolution(captured, resolution);
  }
}

class DeferredAuthorityResolver implements MemoryBankAuthorityResolver {
  readonly requests: MemoryBankAuthorityRequest[] = [];
  #defer = false;
  #release: (() => void) | null = null;

  deferNext(): void {
    if (this.#defer || this.#release) {
      throw new Error("Synthetic authority request is already deferred");
    }
    this.#defer = true;
  }

  releaseNext(): void {
    const release = this.#release;
    if (!release) {
      throw new Error("No synthetic authority request is deferred");
    }
    this.#release = null;
    release();
  }

  async resolve(
    request: MemoryBankAuthorityRequest,
  ): Promise<ResolvedMemoryBankAuthority> {
    const captured = structuredClone(request);
    this.requests.push(captured);
    if (this.#defer) {
      this.#defer = false;
      await new Promise<void>((resolve) => {
        this.#release = resolve;
      });
    }
    return completeSyntheticResolution(captured, {
      bank: workspaceHindsightBank(
        captured.installationId,
        captured.workspaceId,
        captured.installationRealm,
      ),
      dataClassificationCeiling: "restricted",
    });
  }
}

function createGateway(
  hindsight: HindsightAdapter = new InMemoryHindsightAdapter(),
  resolver: MemoryBankAuthorityResolver = new SyntheticAuthorityResolver(),
): ContextGateway {
  return new ContextGateway(hindsight, resolver, clock, {
    testOnlyEnableInMemoryMutations: true,
  });
}

class RecordingHindsightAdapter implements HindsightAdapter {
  readonly calls: Array<{
    operation: "retain" | "retrieve" | "invalidate";
    bank: HindsightBank;
  }> = [];
  readonly #inner = new InMemoryHindsightAdapter();
  readonly #failures = new Map<string, number>();

  failNext(operation: "retain" | "retrieve" | "invalidate"): void {
    this.#failures.set(operation, (this.#failures.get(operation) ?? 0) + 1);
  }

  async ensureBank(bank: HindsightBank): Promise<void> {
    await this.#inner.ensureBank(bank);
  }

  async retain(bank: HindsightBank, memory: HindsightMemory): Promise<void> {
    this.calls.push({ operation: "retain", bank: structuredClone(bank) });
    this.#maybeFail("retain");
    await this.#inner.retain(bank, memory);
  }

  async retrieve(
    bank: HindsightBank,
    query: string,
  ): Promise<HindsightMemory[]> {
    this.calls.push({ operation: "retrieve", bank: structuredClone(bank) });
    this.#maybeFail("retrieve");
    return this.#inner.retrieve(bank, query);
  }

  async invalidateSource(
    bank: HindsightBank,
    sourceRevisionId: string,
    at: string,
  ): Promise<void> {
    this.calls.push({ operation: "invalidate", bank: structuredClone(bank) });
    this.#maybeFail("invalidate");
    await this.#inner.invalidateSource(bank, sourceRevisionId, at);
  }

  #maybeFail(operation: string): void {
    const remaining = this.#failures.get(operation) ?? 0;
    if (remaining === 0) return;
    this.#failures.set(operation, remaining - 1);
    throw new Error(`Synthetic Hindsight ${operation} failure`);
  }
}

function source(
  id = firstId,
  boundary: "personal" | "organizational" | "mixed" = "personal",
  scopedWorkspaceId = workspaceId,
) {
  return {
    id,
    installationId,
    workspaceId: scopedWorkspaceId,
    installationRealm: "personal" as const,
    sourceType: "synthetic-transcript",
    sourceObjectId: "conversation-1",
    sourceUri: "synthetic://conversation-1",
    revisionHash,
    classification: "synthetic" as const,
    boundary,
    observedAt: clock.now(),
    text: id === firstId ? "Lunar apples" : "Lunar oranges",
    citations: [
      {
        sourceRevisionId: id,
        sourceUri: "synthetic://conversation-1",
        revisionHash,
        locator: "utterance:0",
      },
    ],
    authority: structuredClone(authority),
  };
}

describe("Context Gateway", () => {
  it("keeps in-memory mutations disabled by default while preserving retrieval", async () => {
    const resolver = new SyntheticAuthorityResolver();
    const hindsight = new RecordingHindsightAdapter();
    const gateway = new ContextGateway(hindsight, resolver, clock);

    await expect(gateway.admit(source())).rejects.toThrow(
      "explicit test-only in-memory mutation opt-in",
    );
    await expect(
      gateway.consolidate({
        installationId,
        workspaceId,
        installationRealm: "personal",
        derivedMemoryId: "disabled-reflection",
        text: "This mutation must remain disabled",
        sourceRevisionIds: [firstId],
        authority,
      }),
    ).rejects.toThrow("explicit test-only in-memory mutation opt-in");
    await expect(
      gateway.deleteSource({
        installationId,
        workspaceId,
        installationRealm: "personal",
        sourceRevisionId: firstId,
        authority,
      }),
    ).rejects.toThrow("explicit test-only in-memory mutation opt-in");
    expect(resolver.requests).toEqual([]);
    expect(hindsight.calls).toEqual([]);

    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).resolves.toMatchObject({ context: [] });
    expect(resolver.requests.map(({ operation }) => operation)).toEqual([
      "retrieve",
      "retrieve",
    ]);
    expect(hindsight.calls.map(({ operation }) => operation)).toEqual([
      "retrieve",
    ]);
  });

  it("quarantines mixed and cross-realm material before Hindsight", async () => {
    const gateway = createGateway();
    await expect(
      gateway.admit(source(firstId, "mixed")),
    ).resolves.toMatchObject({
      admissionState: "quarantined",
    });
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).resolves.toMatchObject({ context: [] });
  });

  it("returns only cited untrusted context and records a receipt", async () => {
    const gateway = createGateway();
    await gateway.admit(source());
    const result = await gateway.retrieve({
      installationId,
      workspaceId,
      installationRealm: "personal",
      query: "Lunar",
      authority,
    });
    expect(result.context[0]).toMatchObject({
      text: "Lunar apples",
      trust: "untrusted",
      derived: true,
      classification: "synthetic",
      citations: [{ sourceRevisionId: firstId }],
    });
    expect(result.receipt).toMatchObject({
      installationId,
      workspaceId,
      bankId: workspaceHindsightBank(installationId, workspaceId, "personal")
        .id,
      resultIds: [`source:${firstId}`],
      sourceRevisionIds: [firstId],
    });
  });

  it("isolates same-realm workspaces across every memory operation", async () => {
    const gateway = createGateway();
    await gateway.admit({
      ...source(firstId, "personal", workspaceId),
      text: "Alpha workspace lunar apples",
    });
    await gateway.admit({
      ...source(firstId, "personal", otherWorkspaceId),
      text: "Beta workspace lunar oranges",
    });
    await gateway.admit({
      ...source(secondId, "personal", workspaceId),
      sourceObjectId: "alpha-only-conversation",
      text: "Alpha only source",
    });

    await expect(
      gateway.consolidate({
        installationId,
        workspaceId: otherWorkspaceId,
        installationRealm: "personal",
        derivedMemoryId: "foreign-reflection",
        text: "Illegitimate cross-workspace reflection",
        sourceRevisionIds: [secondId],
        authority,
      }),
    ).rejects.toThrow("not active admitted material");

    await gateway.consolidate({
      installationId,
      workspaceId,
      installationRealm: "personal",
      derivedMemoryId: "reflection-1",
      text: "Alpha workspace reflection",
      sourceRevisionIds: [firstId],
      authority,
    });
    await gateway.consolidate({
      installationId,
      workspaceId: otherWorkspaceId,
      installationRealm: "personal",
      derivedMemoryId: "reflection-1",
      text: "Beta workspace reflection",
      sourceRevisionIds: [firstId],
      authority,
    });

    const alphaBeforeDeletion = await gateway.retrieve({
      installationId,
      workspaceId,
      installationRealm: "personal",
      query: "workspace",
      authority,
    });
    const betaBeforeDeletion = await gateway.retrieve({
      installationId,
      workspaceId: otherWorkspaceId,
      installationRealm: "personal",
      query: "workspace",
      authority,
    });
    expect(alphaBeforeDeletion.context.map(({ text }) => text).sort()).toEqual([
      "Alpha workspace lunar apples",
      "Alpha workspace reflection",
    ]);
    expect(betaBeforeDeletion.context.map(({ text }) => text).sort()).toEqual([
      "Beta workspace lunar oranges",
      "Beta workspace reflection",
    ]);
    expect(alphaBeforeDeletion.receipt.bankId).not.toBe(
      betaBeforeDeletion.receipt.bankId,
    );

    await gateway.deleteSource({
      installationId,
      workspaceId,
      installationRealm: "personal",
      sourceRevisionId: firstId,
      authority,
    });

    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "workspace",
        authority,
      }),
    ).resolves.toMatchObject({ context: [] });
    const betaAfterDeletion = await gateway.retrieve({
      installationId,
      workspaceId: otherWorkspaceId,
      installationRealm: "personal",
      query: "workspace",
      authority,
    });
    expect(betaAfterDeletion.context.map(({ text }) => text).sort()).toEqual([
      "Beta workspace lunar oranges",
      "Beta workspace reflection",
    ]);
    await expect(
      gateway.getLineage({
        installationId,
        workspaceId,
        installationRealm: "personal",
        derivedMemoryId: "reflection-1",
        authority,
      }),
    ).resolves.toMatchObject({ invalidatedAt: clock.now() });
    await expect(
      gateway.getLineage({
        installationId,
        workspaceId: otherWorkspaceId,
        installationRealm: "personal",
        derivedMemoryId: "reflection-1",
        authority,
      }),
    ).resolves.toMatchObject({ invalidatedAt: null });
    await expect(
      gateway.getLineage({
        installationId,
        workspaceId,
        installationRealm: "personal",
        derivedMemoryId: "foreign-reflection",
        authority,
      }),
    ).resolves.toBeNull();
    await expect(
      gateway.getLineage({
        installationId,
        workspaceId: otherWorkspaceId,
        installationRealm: "personal",
        derivedMemoryId: "foreign-reflection",
        authority,
      }),
    ).resolves.toBeNull();
    const alphaReceipts = await gateway.getReceipts({
      installationId,
      workspaceId,
      installationRealm: "personal",
      authority,
    });
    const betaReceipts = await gateway.getReceipts({
      installationId,
      workspaceId: otherWorkspaceId,
      installationRealm: "personal",
      authority,
    });
    expect(alphaReceipts).toHaveLength(2);
    expect(betaReceipts).toHaveLength(2);
    expect(
      alphaReceipts.every(
        ({ bankId }) =>
          bankId ===
          workspaceHindsightBank(installationId, workspaceId, "personal").id,
      ),
    ).toBe(true);
    expect(
      betaReceipts.every(
        ({ bankId }) =>
          bankId ===
          workspaceHindsightBank(installationId, otherWorkspaceId, "personal")
            .id,
      ),
    ).toBe(true);
  });

  it("uses the most restrictive active source classification for consolidation", async () => {
    const gateway = createGateway();
    await gateway.admit({
      ...source(firstId),
      sourceObjectId: "public-conversation",
      text: "Public lunar telemetry",
      classification: "public",
    });
    await gateway.admit({
      ...source(secondId),
      sourceObjectId: "restricted-conversation",
      text: "Restricted lunar telemetry",
      classification: "restricted",
    });
    await gateway.consolidate({
      installationId,
      workspaceId,
      installationRealm: "personal",
      derivedMemoryId: "classified-reflection",
      text: "Combined lunar classification",
      sourceRevisionIds: [firstId, secondId],
      authority,
    });

    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Combined",
        authority,
      }),
    ).resolves.toMatchObject({
      context: [{ classification: "restricted" }],
    });
  });

  it("carries transitive parent sources into child lineage and classification", async () => {
    let ceiling: "public" | "restricted" = "restricted";
    const resolver = new SyntheticAuthorityResolver((request) => ({
      bank: workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      ),
      dataClassificationCeiling: ceiling,
    }));
    const gateway = createGateway(new InMemoryHindsightAdapter(), resolver);
    await gateway.admit({
      ...source(firstId),
      sourceObjectId: "restricted-parent-source",
      text: "Restricted parent source",
      classification: "restricted",
    });
    await gateway.admit({
      ...source(secondId),
      sourceObjectId: "public-child-source",
      text: "Public child source",
      classification: "public",
    });
    await gateway.consolidate({
      installationId,
      workspaceId,
      installationRealm: "personal",
      derivedMemoryId: "restricted-parent",
      text: "Restricted parent reflection",
      sourceRevisionIds: [firstId],
      authority,
    });
    const child = await gateway.consolidate({
      installationId,
      workspaceId,
      installationRealm: "personal",
      derivedMemoryId: "transitive-child",
      text: "transitive-token-zeta",
      sourceRevisionIds: [secondId],
      parentMemoryIds: ["restricted-parent"],
      authority,
    });

    expect(child.sourceRevisionIds).toEqual([secondId, firstId]);
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "transitive-token-zeta",
        authority,
      }),
    ).resolves.toMatchObject({
      context: [
        {
          classification: "restricted",
          citations: expect.arrayContaining([
            expect.objectContaining({ sourceRevisionId: firstId }),
            expect.objectContaining({ sourceRevisionId: secondId }),
          ]),
        },
      ],
    });

    ceiling = "public";
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "transitive-token-zeta",
        authority,
      }),
    ).resolves.toMatchObject({ context: [] });
  });

  it("drops derived memory without its canonical classification", async () => {
    const memory = {
      ensureBank: async () => undefined,
      retain: async () => undefined,
      retrieve: async () => [
        {
          id: "malformed-memory",
          text: "Lunar malformed memory",
          citations: source().citations,
          sourceRevisionIds: [firstId],
          invalidatedAt: null,
        },
      ],
      invalidateSource: async () => undefined,
    };
    const gateway = createGateway(memory as unknown as HindsightAdapter);
    await gateway.admit(source());

    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).resolves.toMatchObject({ context: [] });
  });

  it("drops recalled context with substituted citation tuples", async () => {
    const canonicalCitation = source().citations[0]!;
    const substitutions = [
      { ...canonicalCitation, sourceUri: "synthetic://substituted" },
      { ...canonicalCitation, revisionHash: "f".repeat(64) },
      { ...canonicalCitation, locator: "utterance:substituted" },
    ];

    for (const citation of substitutions) {
      const memory: HindsightAdapter = {
        ensureBank: async () => undefined,
        retain: async () => undefined,
        retrieve: async () => [
          {
            id: "citation-substitution",
            text: "Lunar citation substitution",
            classification: "synthetic",
            citations: [citation],
            sourceRevisionIds: [firstId],
            invalidatedAt: null,
          },
        ],
        invalidateSource: async () => undefined,
      };
      const gateway = createGateway(memory);
      await gateway.admit(source());

      await expect(
        gateway.retrieve({
          installationId,
          workspaceId,
          installationRealm: "personal",
          query: "Lunar",
          authority,
        }),
      ).resolves.toMatchObject({ context: [] });
    }
  });

  it("propagates supersession and deletion through consolidation lineage", async () => {
    const gateway = createGateway();
    await gateway.admit(source());
    await gateway.consolidate({
      installationId,
      workspaceId,
      installationRealm: "personal",
      derivedMemoryId: "reflection-1",
      text: "Synthetic fruit reflection",
      sourceRevisionIds: [firstId],
      authority,
    });
    const revised = await gateway.admit({
      ...source(secondId),
      revisionHash: "b".repeat(64),
    });
    expect(revised.supersedesRevisionId).toBe(firstId);
    await expect(
      gateway.getLineage({
        installationId,
        workspaceId,
        installationRealm: "personal",
        derivedMemoryId: "reflection-1",
        authority,
      }),
    ).resolves.toMatchObject({ invalidatedAt: clock.now() });
    await gateway.deleteSource({
      installationId,
      workspaceId,
      installationRealm: "personal",
      sourceRevisionId: secondId,
      authority,
    });
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).resolves.toMatchObject({ context: [] });
  });

  it("rejects attempts to reuse one installation across realms", async () => {
    const gateway = createGateway();
    await gateway.admit(source());
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "organizational",
        query: "Lunar",
        authority,
      }),
    ).rejects.toThrow("cannot cross");
  });

  it("fails closed before Hindsight or local state when authority is denied", async () => {
    let denied = true;
    const resolver = new SyntheticAuthorityResolver((request) => {
      if (denied) throw new Error("Synthetic authority denial");
      return workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      );
    });
    const hindsight = new RecordingHindsightAdapter();
    const gateway = createGateway(hindsight, resolver);

    await expect(gateway.admit(source())).rejects.toThrow("authority denial");
    expect(hindsight.calls).toEqual([]);

    denied = false;
    await expect(gateway.admit(source())).resolves.toMatchObject({
      supersedesRevisionId: null,
    });
    expect(hindsight.calls.map(({ operation }) => operation)).toEqual([
      "retain",
    ]);
  });

  it("rejects substituted workspace, realm, and bank identities", async () => {
    const substitutions: Array<
      (request: MemoryBankAuthorityRequest) => HindsightBank
    > = [
      (request) =>
        workspaceHindsightBank(
          request.installationId,
          otherWorkspaceId,
          request.installationRealm,
        ),
      (request) =>
        workspaceHindsightBank(
          request.installationId,
          request.workspaceId,
          "organizational",
        ),
      (request) => ({
        ...workspaceHindsightBank(
          request.installationId,
          request.workspaceId,
          request.installationRealm,
        ),
        id: `personal:${request.installationId}:${request.workspaceId}:legacy`,
      }),
    ];

    for (const substitution of substitutions) {
      const hindsight = new RecordingHindsightAdapter();
      const gateway = createGateway(
        hindsight,
        new SyntheticAuthorityResolver(substitution),
      );
      await expect(gateway.admit(source())).rejects.toThrow(
        "does not match the requested workspace and realm",
      );
      expect(hindsight.calls).toEqual([]);
    }
  });

  it("requires fresh authority for exact admission replay", async () => {
    let permitted = true;
    const resolver = new SyntheticAuthorityResolver((request) => {
      if (!permitted) throw new Error("Replay authority revoked");
      return workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      );
    });
    const hindsight = new RecordingHindsightAdapter();
    const gateway = createGateway(hindsight, resolver);

    await gateway.admit(source());
    permitted = false;
    await expect(gateway.admit(source())).rejects.toThrow(
      "Replay authority revoked",
    );
    expect(resolver.requests.map(({ operation }) => operation)).toEqual([
      "retain",
      "retain",
    ]);
    expect(hindsight.calls.map(({ operation }) => operation)).toEqual([
      "retain",
    ]);
  });

  it("rejects conflicting immutable content under an existing source revision ID", async () => {
    const resolver = new SyntheticAuthorityResolver();
    const hindsight = new RecordingHindsightAdapter();
    const gateway = createGateway(hindsight, resolver);

    await gateway.admit(source());
    await expect(
      gateway.admit({
        ...source(),
        text: "Conflicting lunar pears",
      }),
    ).rejects.toThrow(
      "Source revision ID conflicts with immutable source content",
    );
    expect(resolver.requests.map(({ operation }) => operation)).toEqual([
      "retain",
      "retain",
    ]);
    expect(hindsight.calls.map(({ operation }) => operation)).toEqual([
      "retain",
    ]);
  });

  it("snapshots every caller-owned request before awaiting authority", async () => {
    const resolver = new DeferredAuthorityResolver();
    const gateway = createGateway(new InMemoryHindsightAdapter(), resolver);

    const admission = source();
    resolver.deferNext();
    const admitted = gateway.admit(admission);
    admission.workspaceId = otherWorkspaceId;
    admission.text = "Mutated after authorization began";
    admission.citations[0]!.locator = "mutated:0";
    admission.authority.workId = null;
    resolver.releaseNext();
    await expect(admitted).resolves.toMatchObject({
      workspaceId,
      id: firstId,
    });

    const consolidation = {
      installationId,
      workspaceId,
      installationRealm: "personal" as const,
      derivedMemoryId: "snapshot-reflection",
      text: "Stable reflection",
      sourceRevisionIds: [firstId],
      parentMemoryIds: [] as string[],
      authority: structuredClone(authority),
    };
    resolver.deferNext();
    const consolidated = gateway.consolidate(consolidation);
    consolidation.workspaceId = otherWorkspaceId;
    consolidation.derivedMemoryId = "mutated-reflection";
    consolidation.text = "Mutated reflection";
    consolidation.sourceRevisionIds[0] = secondId;
    consolidation.authority.workId = null;
    resolver.releaseNext();
    await expect(consolidated).resolves.toMatchObject({
      workspaceId,
      derivedMemoryId: "snapshot-reflection",
      sourceRevisionIds: [firstId],
    });

    const retrieval = {
      installationId,
      workspaceId,
      installationRealm: "personal" as const,
      query: "Stable",
      authority: structuredClone(authority),
    };
    resolver.deferNext();
    const retrieved = gateway.retrieve(retrieval);
    retrieval.workspaceId = otherWorkspaceId;
    retrieval.query = "Mutated";
    retrieval.authority.workId = null;
    resolver.releaseNext();
    await expect(retrieved).resolves.toMatchObject({
      context: [{ text: "Stable reflection" }],
      receipt: { workspaceId, queryHash: revisionHashFor("Stable") },
    });

    const lineageRequest = {
      installationId,
      workspaceId,
      installationRealm: "personal" as const,
      derivedMemoryId: "snapshot-reflection",
      authority: structuredClone(authority),
    };
    resolver.deferNext();
    const lineage = gateway.getLineage(lineageRequest);
    lineageRequest.workspaceId = otherWorkspaceId;
    lineageRequest.derivedMemoryId = "mutated-reflection";
    lineageRequest.authority.workId = null;
    resolver.releaseNext();
    await expect(lineage).resolves.toMatchObject({
      workspaceId,
      derivedMemoryId: "snapshot-reflection",
    });

    const receiptRequest = {
      installationId,
      workspaceId,
      installationRealm: "personal" as const,
      authority: structuredClone(authority),
    };
    resolver.deferNext();
    const receipts = gateway.getReceipts(receiptRequest);
    receiptRequest.workspaceId = otherWorkspaceId;
    receiptRequest.authority.workId = null;
    resolver.releaseNext();
    await expect(receipts).resolves.toHaveLength(1);

    const deletion = {
      installationId,
      workspaceId,
      installationRealm: "personal" as const,
      sourceRevisionId: firstId,
      authority: structuredClone(authority),
    };
    resolver.deferNext();
    const deleted = gateway.deleteSource(deletion);
    deletion.workspaceId = otherWorkspaceId;
    deletion.sourceRevisionId = secondId;
    deletion.authority.workId = null;
    resolver.releaseNext();
    await expect(deleted).resolves.toBeUndefined();
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Stable",
        authority,
      }),
    ).resolves.toMatchObject({ context: [] });
  });

  it("enforces and revalidates the PostgreSQL classification ceiling", async () => {
    let ceiling: "public" | "restricted" = "public";
    const resolver = new SyntheticAuthorityResolver((request) => ({
      bank: workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      ),
      dataClassificationCeiling: ceiling,
    }));
    const hindsight = new RecordingHindsightAdapter();
    const gateway = createGateway(hindsight, resolver);

    await expect(
      gateway.admit({ ...source(), classification: "restricted" }),
    ).rejects.toThrow("exceeds the resolved public ceiling");
    expect(hindsight.calls).toEqual([]);

    ceiling = "restricted";
    await gateway.admit({ ...source(), classification: "restricted" });
    await gateway.consolidate({
      installationId,
      workspaceId,
      installationRealm: "personal",
      derivedMemoryId: "restricted-reflection",
      text: "Restricted lunar reflection",
      sourceRevisionIds: [firstId],
      authority,
    });
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).resolves.toMatchObject({
      context: [
        { classification: "restricted" },
        { classification: "restricted" },
      ],
    });
    ceiling = "public";
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).resolves.toMatchObject({ context: [] });
    await expect(
      gateway.getLineage({
        installationId,
        workspaceId,
        installationRealm: "personal",
        derivedMemoryId: "restricted-reflection",
        authority,
      }),
    ).resolves.toBeNull();
    await expect(
      gateway.getReceipts({
        installationId,
        workspaceId,
        installationRealm: "personal",
        authority,
      }),
    ).resolves.toMatchObject([{ resultIds: [], sourceRevisionIds: [] }]);
    await expect(
      gateway.deleteSource({
        installationId,
        workspaceId,
        installationRealm: "personal",
        sourceRevisionId: firstId,
        authority,
      }),
    ).rejects.toThrow("exceeds the resolved public ceiling");

    let retrieveCall = 0;
    const changingResolver = new SyntheticAuthorityResolver((request) => ({
      bank: workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      ),
      dataClassificationCeiling:
        request.operation === "retrieve" && ++retrieveCall > 1
          ? "public"
          : "restricted",
    }));
    const changingGateway = createGateway(
      new InMemoryHindsightAdapter(),
      changingResolver,
    );
    await changingGateway.admit({
      ...source(),
      classification: "restricted",
    });
    await expect(
      changingGateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).rejects.toThrow("authority changed during retrieval");
  });

  it("requests exact operation grants for every gateway effect", async () => {
    const resolver = new SyntheticAuthorityResolver();
    const gateway = createGateway(new InMemoryHindsightAdapter(), resolver);

    await gateway.admit(source());
    await gateway.consolidate({
      installationId,
      workspaceId,
      installationRealm: "personal",
      derivedMemoryId: "operation-reflection",
      text: "Operation reflection",
      sourceRevisionIds: [firstId],
      authority,
    });
    await gateway.retrieve({
      installationId,
      workspaceId,
      installationRealm: "personal",
      query: "Operation",
      authority,
    });
    await gateway.admit({
      ...source(secondId),
      revisionHash: "b".repeat(64),
    });
    await gateway.deleteSource({
      installationId,
      workspaceId,
      installationRealm: "personal",
      sourceRevisionId: secondId,
      authority,
    });

    expect(resolver.requests.map(({ operation }) => operation)).toEqual([
      "retain",
      "consolidate",
      "retrieve",
      "retrieve",
      "retain",
      "invalidate",
      "retain",
      "invalidate",
    ]);
  });

  it("revalidates retrieval after Hindsight and discards results on revocation", async () => {
    let retrieveGrants = 0;
    let revokePostCall = false;
    const resolver = new SyntheticAuthorityResolver((request) => {
      if (request.operation === "retrieve") {
        retrieveGrants += 1;
        if (revokePostCall && retrieveGrants === 2) {
          throw new Error("Authority revoked during retrieval");
        }
      }
      return workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      );
    });
    const hindsight = new RecordingHindsightAdapter();
    const gateway = createGateway(hindsight, resolver);
    await gateway.admit(source());

    revokePostCall = true;
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).rejects.toThrow("revoked during retrieval");
    expect(hindsight.calls.map(({ operation }) => operation)).toEqual([
      "retain",
      "retrieve",
    ]);

    revokePostCall = false;
    retrieveGrants = 0;
    await expect(
      gateway.getReceipts({
        installationId,
        workspaceId,
        installationRealm: "personal",
        authority,
      }),
    ).resolves.toEqual([]);
  });

  it("leaves inspectable local state unchanged when Hindsight fails", async () => {
    const hindsight = new RecordingHindsightAdapter();
    const gateway = createGateway(hindsight);
    hindsight.failNext("retain");

    await expect(gateway.admit(source())).rejects.toThrow("retain failure");
    await expect(gateway.admit(source())).resolves.toMatchObject({
      supersedesRevisionId: null,
    });

    hindsight.failNext("retain");
    await expect(
      gateway.consolidate({
        installationId,
        workspaceId,
        installationRealm: "personal",
        derivedMemoryId: "failed-reflection",
        text: "This should not become local lineage",
        sourceRevisionIds: [firstId],
        authority,
      }),
    ).rejects.toThrow("retain failure");
    await expect(
      gateway.getLineage({
        installationId,
        workspaceId,
        installationRealm: "personal",
        derivedMemoryId: "failed-reflection",
        authority,
      }),
    ).resolves.toBeNull();

    hindsight.failNext("invalidate");
    await expect(
      gateway.deleteSource({
        installationId,
        workspaceId,
        installationRealm: "personal",
        sourceRevisionId: firstId,
        authority,
      }),
    ).rejects.toThrow("invalidate failure");
    await expect(
      gateway.retrieve({
        installationId,
        workspaceId,
        installationRealm: "personal",
        query: "Lunar",
        authority,
      }),
    ).resolves.toMatchObject({ context: [{ text: "Lunar apples" }] });

    hindsight.failNext("retain");
    await expect(
      gateway.admit({
        ...source(secondId),
        revisionHash: "b".repeat(64),
      }),
    ).rejects.toThrow("retain failure");
    await expect(
      gateway.admit({
        ...source(secondId),
        revisionHash: "b".repeat(64),
      }),
    ).resolves.toMatchObject({ supersedesRevisionId: firstId });
  });

  it("propagates Work binding without accepting identity in operation payloads", async () => {
    const resolver = new SyntheticAuthorityResolver();
    const gateway = createGateway(new InMemoryHindsightAdapter(), resolver);
    const unscopedAuthority: MemoryAuthorityContext = { workId: null };

    await gateway.admit({ ...source(), authority: unscopedAuthority });
    await gateway.retrieve({
      installationId,
      workspaceId,
      installationRealm: "personal",
      query: "Lunar",
      authority: unscopedAuthority,
    });

    expect(resolver.requests).toHaveLength(3);
    expect(
      resolver.requests.every(
        (request) =>
          request.installationId === installationId &&
          request.workspaceId === workspaceId &&
          request.installationRealm === "personal" &&
          request.workId === null &&
          !("subject" in request),
      ),
    ).toBe(true);
  });

  it("requires live retrieve authority for local lineage and receipt reads", async () => {
    let permitted = true;
    const resolver = new SyntheticAuthorityResolver((request) => {
      if (!permitted) throw new Error("Local read authority revoked");
      return workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      );
    });
    const gateway = createGateway(new InMemoryHindsightAdapter(), resolver);
    await gateway.admit(source());
    await gateway.retrieve({
      installationId,
      workspaceId,
      installationRealm: "personal",
      query: "Lunar",
      authority,
    });
    permitted = false;

    await expect(
      gateway.getLineage({
        installationId,
        workspaceId,
        installationRealm: "personal",
        derivedMemoryId: "missing",
        authority,
      }),
    ).rejects.toThrow("Local read authority revoked");
    await expect(
      gateway.getReceipts({
        installationId,
        workspaceId,
        installationRealm: "personal",
        authority,
      }),
    ).rejects.toThrow("Local read authority revoked");
  });

  it("requires retain authority for quarantine without calling Hindsight", async () => {
    const resolver = new SyntheticAuthorityResolver();
    const hindsight = new RecordingHindsightAdapter();
    const gateway = createGateway(hindsight, resolver);

    await expect(
      gateway.admit(source(firstId, "mixed")),
    ).resolves.toMatchObject({ admissionState: "quarantined" });
    expect(resolver.requests.map(({ operation }) => operation)).toEqual([
      "retain",
    ]);
    expect(hindsight.calls).toEqual([]);
  });
});
