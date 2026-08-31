import { createHash } from "node:crypto";

import {
  deriveDataClassification,
  retrievedContextSchema,
  type AdmissionState,
  type InstallationRealm,
  type RetrievalReceipt,
  type RetrievedContext,
  type SourceBoundary,
  type SourceCitation,
  type SourceRevision,
} from "@vorton/contracts";
import {
  installationHindsightBank,
  type HindsightAdapter,
  type HindsightBank,
  type HindsightMemory,
} from "@vorton/memory";

export type AdmitSourceInput = Omit<
  SourceRevision,
  "admissionState" | "supersedesRevisionId" | "deletedAt"
> & {
  text: string;
  citations: SourceCitation[];
};

export type ConsolidationLineage = {
  derivedMemoryId: string;
  installationId: string;
  workspaceId: string;
  sourceRevisionIds: string[];
  parentMemoryIds: string[];
  createdAt: string;
  invalidatedAt: string | null;
};

export type RetrievalResult = {
  context: RetrievedContext[];
  receipt: RetrievalReceipt;
};

export type GatewayClock = { now(): string };

const systemClock: GatewayClock = { now: () => new Date().toISOString() };

/**
 * The gateway exposes memory context only. It deliberately has no operation for
 * creating Records, Policies, capabilities, approvals, decisions, or Work.
 */
export class ContextGateway {
  readonly #hindsight: HindsightAdapter;
  readonly #clock: GatewayClock;
  readonly #sources = new Map<string, AdmitSourceInput & SourceRevision>();
  readonly #deletedSources = new Map<string, string>();
  readonly #workspaceRealms = new Map<string, InstallationRealm>();
  readonly #latestByObject = new Map<string, string>();
  readonly #lineage = new Map<string, ConsolidationLineage>();
  readonly #receipts: RetrievalReceipt[] = [];
  #receiptSequence = 0;

  constructor(hindsight: HindsightAdapter, clock: GatewayClock = systemClock) {
    this.#hindsight = hindsight;
    this.#clock = clock;
  }

  async admit(input: AdmitSourceInput): Promise<SourceRevision> {
    this.#assertRealm(
      input.installationId,
      input.workspaceId,
      input.installationRealm,
    );
    const expectedBoundary = realmBoundary(input.installationRealm);
    const admissionState: AdmissionState =
      input.boundary === "mixed" || input.boundary !== expectedBoundary
        ? "quarantined"
        : "admitted";
    const objectKey = this.#objectKey(input);
    const priorId = this.#latestByObject.get(objectKey) ?? null;
    const existing = this.#sources.get(
      this.#sourceKey(input.installationId, input.workspaceId, input.id),
    );
    if (existing) return stripContent(existing);

    const revision: AdmitSourceInput & SourceRevision = {
      ...structuredClone(input),
      admissionState,
      supersedesRevisionId: priorId,
      deletedAt: null,
    };
    this.#sources.set(
      this.#sourceKey(input.installationId, input.workspaceId, input.id),
      revision,
    );
    this.#latestByObject.set(objectKey, input.id);

    if (priorId)
      await this.#invalidate(
        input.installationId,
        input.workspaceId,
        input.installationRealm,
        priorId,
      );
    if (admissionState === "admitted") {
      await this.#hindsight.retain(
        this.#bank(
          input.installationId,
          input.workspaceId,
          input.installationRealm,
        ),
        {
          id: `source:${input.id}`,
          text: input.text,
          classification: input.classification,
          citations: structuredClone(input.citations),
          sourceRevisionIds: [input.id],
          invalidatedAt: null,
        },
      );
    }
    return stripContent(revision);
  }

  async consolidate(input: {
    installationId: string;
    workspaceId: string;
    installationRealm: InstallationRealm;
    derivedMemoryId: string;
    text: string;
    sourceRevisionIds: string[];
    parentMemoryIds?: string[];
  }): Promise<ConsolidationLineage> {
    this.#assertRealm(
      input.installationId,
      input.workspaceId,
      input.installationRealm,
    );
    if (input.sourceRevisionIds.length === 0) {
      throw new Error(
        "Consolidation requires at least one canonical source revision",
      );
    }
    for (const parentId of input.parentMemoryIds ?? []) {
      const parent = this.#lineage.get(
        this.#lineageKey(input.installationId, input.workspaceId, parentId),
      );
      if (
        !parent ||
        parent.installationId !== input.installationId ||
        parent.workspaceId !== input.workspaceId ||
        parent.invalidatedAt
      ) {
        throw new Error(
          `Parent memory ${parentId} is not active in this installation`,
        );
      }
    }
    const sources = input.sourceRevisionIds.map((id) => {
      const source = this.#sources.get(
        this.#sourceKey(input.installationId, input.workspaceId, id),
      );
      if (
        !source ||
        source.admissionState !== "admitted" ||
        this.#deletedSources.has(
          this.#sourceKey(input.installationId, input.workspaceId, id),
        )
      ) {
        throw new Error(
          `Source revision ${id} is not active admitted material`,
        );
      }
      if (source.installationRealm !== input.installationRealm) {
        throw new Error("Consolidation cannot cross installation realms");
      }
      return source;
    });
    const citations = uniqueCitations(
      sources.flatMap((source) => source.citations),
    );
    const classification = deriveDataClassification(
      sources.map((source) => source.classification),
    );
    const lineage: ConsolidationLineage = {
      derivedMemoryId: input.derivedMemoryId,
      installationId: input.installationId,
      workspaceId: input.workspaceId,
      sourceRevisionIds: [...input.sourceRevisionIds],
      parentMemoryIds: [...(input.parentMemoryIds ?? [])],
      createdAt: this.#clock.now(),
      invalidatedAt: null,
    };
    this.#lineage.set(
      this.#lineageKey(
        input.installationId,
        input.workspaceId,
        input.derivedMemoryId,
      ),
      lineage,
    );
    await this.#hindsight.retain(
      this.#bank(
        input.installationId,
        input.workspaceId,
        input.installationRealm,
      ),
      {
        id: input.derivedMemoryId,
        text: input.text,
        classification,
        citations,
        sourceRevisionIds: [...input.sourceRevisionIds],
        invalidatedAt: null,
      },
    );
    return structuredClone(lineage);
  }

  async retrieve(input: {
    installationId: string;
    workspaceId: string;
    installationRealm: InstallationRealm;
    query: string;
  }): Promise<RetrievalResult> {
    this.#assertRealm(
      input.installationId,
      input.workspaceId,
      input.installationRealm,
    );
    const bank = this.#bank(
      input.installationId,
      input.workspaceId,
      input.installationRealm,
    );
    const memories = await this.#hindsight.retrieve(bank, input.query);
    const admittedMemories = memories.flatMap((memory) => {
      const context = this.#toUntrustedContext(
        input.installationId,
        input.workspaceId,
        input.installationRealm,
        memory,
      );
      return context ? [{ memory, context }] : [];
    });
    this.#receiptSequence += 1;
    const receipt: RetrievalReceipt = {
      id: deterministicUuid(
        `receipt:${this.#clock.now()}:${input.installationId}:${input.workspaceId}:${input.query}:${this.#receiptSequence}`,
      ),
      installationId: input.installationId,
      workspaceId: input.workspaceId,
      bankId: bank.id,
      queryHash: sha256(input.query),
      resultIds: admittedMemories.map(({ memory }) => memory.id),
      sourceRevisionIds: [
        ...new Set(
          admittedMemories.flatMap(({ memory }) => memory.sourceRevisionIds),
        ),
      ],
      retrievedAt: this.#clock.now(),
    };
    this.#receipts.push(receipt);
    return {
      context: admittedMemories.map(({ context }) => context),
      receipt: structuredClone(receipt),
    };
  }

  async deleteSource(input: {
    installationId: string;
    workspaceId: string;
    installationRealm: InstallationRealm;
    sourceRevisionId: string;
  }): Promise<void> {
    this.#assertRealm(
      input.installationId,
      input.workspaceId,
      input.installationRealm,
    );
    const source = this.#sources.get(
      this.#sourceKey(
        input.installationId,
        input.workspaceId,
        input.sourceRevisionId,
      ),
    );
    if (!source || source.installationRealm !== input.installationRealm) return;
    this.#deletedSources.set(
      this.#sourceKey(
        input.installationId,
        input.workspaceId,
        input.sourceRevisionId,
      ),
      this.#clock.now(),
    );
    await this.#invalidate(
      input.installationId,
      input.workspaceId,
      input.installationRealm,
      input.sourceRevisionId,
    );
  }

  getLineage(
    installationId: string,
    workspaceId: string,
    derivedMemoryId: string,
  ): ConsolidationLineage | null {
    const lineage = this.#lineage.get(
      this.#lineageKey(installationId, workspaceId, derivedMemoryId),
    );
    return lineage ? structuredClone(lineage) : null;
  }

  getReceipts(installationId: string, workspaceId: string): RetrievalReceipt[] {
    return structuredClone(
      this.#receipts.filter(
        (receipt) =>
          receipt.installationId === installationId &&
          receipt.workspaceId === workspaceId,
      ),
    );
  }

  async #invalidate(
    installationId: string,
    workspaceId: string,
    realm: InstallationRealm,
    sourceRevisionId: string,
  ): Promise<void> {
    const at = this.#clock.now();
    await this.#hindsight.invalidateSource(
      this.#bank(installationId, workspaceId, realm),
      sourceRevisionId,
      at,
    );
    for (const lineage of this.#lineage.values()) {
      if (
        lineage.installationId === installationId &&
        lineage.workspaceId === workspaceId &&
        lineage.sourceRevisionIds.includes(sourceRevisionId)
      ) {
        lineage.invalidatedAt = at;
      }
    }
  }

  #bank(
    installationId: string,
    workspaceId: string,
    realm: InstallationRealm,
  ): HindsightBank {
    return installationHindsightBank(`${installationId}:${workspaceId}`, realm);
  }

  #sourceKey(
    installationId: string,
    workspaceId: string,
    sourceRevisionId: string,
  ): string {
    return `${installationId}\u0000${workspaceId}\u0000${sourceRevisionId}`;
  }

  #lineageKey(
    installationId: string,
    workspaceId: string,
    derivedMemoryId: string,
  ): string {
    return `${installationId}\u0000${workspaceId}\u0000${derivedMemoryId}`;
  }

  #toUntrustedContext(
    installationId: string,
    workspaceId: string,
    realm: InstallationRealm,
    memory: HindsightMemory,
  ): RetrievedContext | null {
    if (memory.sourceRevisionIds.length === 0) return null;
    const sources = memory.sourceRevisionIds.map((sourceRevisionId) =>
      this.#sources.get(
        this.#sourceKey(installationId, workspaceId, sourceRevisionId),
      ),
    );
    if (
      sources.some(
        (source) =>
          !source ||
          source.admissionState !== "admitted" ||
          source.installationRealm !== realm ||
          this.#deletedSources.has(
            this.#sourceKey(installationId, workspaceId, source.id),
          ),
      )
    ) {
      return null;
    }
    const activeSources = sources.filter(
      (source): source is AdmitSourceInput & SourceRevision => Boolean(source),
    );
    const citationRevisionIds = memory.citations.map(
      (citation) => citation.sourceRevisionId,
    );
    if (!sameStringSet(memory.sourceRevisionIds, citationRevisionIds)) {
      return null;
    }
    const classification = deriveDataClassification(
      activeSources.map((source) => source.classification),
    );
    if (memory.classification !== classification) return null;
    const parsed = retrievedContextSchema.safeParse({
      text: memory.text,
      trust: "untrusted",
      derived: true,
      classification,
      citations: memory.citations,
    });
    return parsed.success ? parsed.data : null;
  }

  #assertRealm(
    installationId: string,
    workspaceId: string,
    realm: InstallationRealm,
  ): void {
    const key = `${installationId}\u0000${workspaceId}`;
    const established = this.#workspaceRealms.get(key);
    if (established && established !== realm) {
      throw new Error(
        "A workspace cannot cross personal and organizational realms",
      );
    }
    this.#workspaceRealms.set(key, realm);
  }

  #objectKey(
    input: Pick<
      AdmitSourceInput,
      "installationId" | "workspaceId" | "sourceType" | "sourceObjectId"
    >,
  ): string {
    return `${input.installationId}\u0000${input.workspaceId}\u0000${input.sourceType}\u0000${input.sourceObjectId}`;
  }
}

function realmBoundary(realm: InstallationRealm): SourceBoundary {
  return realm === "personal" ? "personal" : "organizational";
}

function stripContent(
  source: AdmitSourceInput & SourceRevision,
): SourceRevision {
  const { text: _text, citations: _citations, ...revision } = source;
  return structuredClone(revision);
}

function uniqueCitations(citations: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.sourceRevisionId}:${citation.locator}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(value: string): string {
  const hash = sha256(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
