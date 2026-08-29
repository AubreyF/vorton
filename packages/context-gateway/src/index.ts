import { createHash } from "node:crypto";

import type {
  AdmissionState,
  InstallationRealm,
  RetrievalReceipt,
  RetrievedContext,
  SourceBoundary,
  SourceCitation,
  SourceRevision,
} from "@aubos/contracts";
import type {
  HindsightAdapter,
  HindsightBank,
  HindsightMemory,
} from "@aubos/memory";

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
  readonly #installationRealms = new Map<string, InstallationRealm>();
  readonly #latestByObject = new Map<string, string>();
  readonly #lineage = new Map<string, ConsolidationLineage>();
  readonly #receipts: RetrievalReceipt[] = [];
  #receiptSequence = 0;

  constructor(hindsight: HindsightAdapter, clock: GatewayClock = systemClock) {
    this.#hindsight = hindsight;
    this.#clock = clock;
  }

  async admit(input: AdmitSourceInput): Promise<SourceRevision> {
    this.#assertRealm(input.installationId, input.installationRealm);
    const expectedBoundary = realmBoundary(input.installationRealm);
    const admissionState: AdmissionState =
      input.boundary === "mixed" || input.boundary !== expectedBoundary
        ? "quarantined"
        : "admitted";
    const objectKey = this.#objectKey(input);
    const priorId = this.#latestByObject.get(objectKey) ?? null;
    const existing = this.#sources.get(
      this.#sourceKey(input.installationId, input.id),
    );
    if (existing) return stripContent(existing);

    const revision: AdmitSourceInput & SourceRevision = {
      ...structuredClone(input),
      admissionState,
      supersedesRevisionId: priorId,
      deletedAt: null,
    };
    this.#sources.set(
      this.#sourceKey(input.installationId, input.id),
      revision,
    );
    this.#latestByObject.set(objectKey, input.id);

    if (priorId)
      await this.#invalidate(
        input.installationId,
        input.installationRealm,
        priorId,
      );
    if (admissionState === "admitted") {
      await this.#hindsight.retain(
        this.#bank(input.installationId, input.installationRealm),
        {
          id: `source:${input.id}`,
          text: input.text,
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
    installationRealm: InstallationRealm;
    derivedMemoryId: string;
    text: string;
    sourceRevisionIds: string[];
    parentMemoryIds?: string[];
  }): Promise<ConsolidationLineage> {
    this.#assertRealm(input.installationId, input.installationRealm);
    if (input.sourceRevisionIds.length === 0) {
      throw new Error(
        "Consolidation requires at least one canonical source revision",
      );
    }
    for (const parentId of input.parentMemoryIds ?? []) {
      const parent = this.#lineage.get(
        this.#lineageKey(input.installationId, parentId),
      );
      if (
        !parent ||
        parent.installationId !== input.installationId ||
        parent.invalidatedAt
      ) {
        throw new Error(
          `Parent memory ${parentId} is not active in this installation`,
        );
      }
    }
    const sources = input.sourceRevisionIds.map((id) => {
      const source = this.#sources.get(
        this.#sourceKey(input.installationId, id),
      );
      if (
        !source ||
        source.admissionState !== "admitted" ||
        this.#deletedSources.has(this.#sourceKey(input.installationId, id))
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
    const lineage: ConsolidationLineage = {
      derivedMemoryId: input.derivedMemoryId,
      installationId: input.installationId,
      sourceRevisionIds: [...input.sourceRevisionIds],
      parentMemoryIds: [...(input.parentMemoryIds ?? [])],
      createdAt: this.#clock.now(),
      invalidatedAt: null,
    };
    this.#lineage.set(
      this.#lineageKey(input.installationId, input.derivedMemoryId),
      lineage,
    );
    await this.#hindsight.retain(
      this.#bank(input.installationId, input.installationRealm),
      {
        id: input.derivedMemoryId,
        text: input.text,
        citations,
        sourceRevisionIds: [...input.sourceRevisionIds],
        invalidatedAt: null,
      },
    );
    return structuredClone(lineage);
  }

  async retrieve(input: {
    installationId: string;
    installationRealm: InstallationRealm;
    query: string;
  }): Promise<RetrievalResult> {
    this.#assertRealm(input.installationId, input.installationRealm);
    const bank = this.#bank(input.installationId, input.installationRealm);
    const memories = await this.#hindsight.retrieve(bank, input.query);
    this.#receiptSequence += 1;
    const receipt: RetrievalReceipt = {
      id: deterministicUuid(
        `receipt:${this.#clock.now()}:${input.installationId}:${input.query}:${this.#receiptSequence}`,
      ),
      installationId: input.installationId,
      bankId: bank.id,
      queryHash: sha256(input.query),
      resultIds: memories.map((memory) => memory.id),
      sourceRevisionIds: [
        ...new Set(memories.flatMap((memory) => memory.sourceRevisionIds)),
      ],
      retrievedAt: this.#clock.now(),
    };
    this.#receipts.push(receipt);
    return {
      context: memories.map(toUntrustedContext),
      receipt: structuredClone(receipt),
    };
  }

  async deleteSource(input: {
    installationId: string;
    installationRealm: InstallationRealm;
    sourceRevisionId: string;
  }): Promise<void> {
    this.#assertRealm(input.installationId, input.installationRealm);
    const source = this.#sources.get(
      this.#sourceKey(input.installationId, input.sourceRevisionId),
    );
    if (!source || source.installationRealm !== input.installationRealm) return;
    this.#deletedSources.set(
      this.#sourceKey(input.installationId, input.sourceRevisionId),
      this.#clock.now(),
    );
    await this.#invalidate(
      input.installationId,
      input.installationRealm,
      input.sourceRevisionId,
    );
  }

  getLineage(
    installationId: string,
    derivedMemoryId: string,
  ): ConsolidationLineage | null {
    const lineage = this.#lineage.get(
      this.#lineageKey(installationId, derivedMemoryId),
    );
    return lineage ? structuredClone(lineage) : null;
  }

  getReceipts(installationId: string): RetrievalReceipt[] {
    return structuredClone(
      this.#receipts.filter(
        (receipt) => receipt.installationId === installationId,
      ),
    );
  }

  async #invalidate(
    installationId: string,
    realm: InstallationRealm,
    sourceRevisionId: string,
  ): Promise<void> {
    const at = this.#clock.now();
    await this.#hindsight.invalidateSource(
      this.#bank(installationId, realm),
      sourceRevisionId,
      at,
    );
    for (const lineage of this.#lineage.values()) {
      if (
        lineage.installationId === installationId &&
        lineage.sourceRevisionIds.includes(sourceRevisionId)
      ) {
        lineage.invalidatedAt = at;
      }
    }
  }

  #bank(installationId: string, realm: InstallationRealm): HindsightBank {
    return {
      id: `${realm}:${installationId}:default`,
      installationId,
      realm,
    };
  }

  #sourceKey(installationId: string, sourceRevisionId: string): string {
    return `${installationId}\u0000${sourceRevisionId}`;
  }

  #lineageKey(installationId: string, derivedMemoryId: string): string {
    return `${installationId}\u0000${derivedMemoryId}`;
  }

  #assertRealm(installationId: string, realm: InstallationRealm): void {
    const established = this.#installationRealms.get(installationId);
    if (established && established !== realm) {
      throw new Error(
        "An installation cannot cross personal and organizational realms",
      );
    }
    this.#installationRealms.set(installationId, realm);
  }

  #objectKey(
    input: Pick<
      AdmitSourceInput,
      "installationId" | "sourceType" | "sourceObjectId"
    >,
  ): string {
    return `${input.installationId}\u0000${input.sourceType}\u0000${input.sourceObjectId}`;
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

function toUntrustedContext(memory: HindsightMemory): RetrievedContext {
  return {
    text: memory.text,
    trust: "untrusted",
    derived: true,
    citations: structuredClone(memory.citations),
  };
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(value: string): string {
  const hash = sha256(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
