import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  deriveDataClassification,
  retrievedContextSchema,
  type AdmissionState,
  type DataClassification,
  type InstallationRealm,
  type RetrievalReceipt,
  type RetrievedContext,
  type SourceBoundary,
  type SourceCitation,
  type SourceRevision,
} from "@vorton/contracts";
import {
  type HindsightAdapter,
  type HindsightBank,
  type HindsightMemory,
  workspaceHindsightBank,
} from "@vorton/memory";

export type AdmitSourceInput = Omit<
  SourceRevision,
  "admissionState" | "supersedesRevisionId" | "deletedAt"
> & {
  text: string;
  citations: SourceCitation[];
  authority: MemoryAuthorityContext;
};

export type MemoryGatewayOperation =
  "retain" | "consolidate" | "retrieve" | "invalidate";

export type MemoryAuthoritySubject =
  | { kind: "person"; authUserId: string }
  | { kind: "worker"; workerId: string; credentialId: string };

export type MemoryAuthorityContext = {
  workId: string | null;
};

export type MemoryBankAuthorityRequest = {
  operation: MemoryGatewayOperation;
  installationId: string;
  workspaceId: string;
  installationRealm: InstallationRealm;
  workId: string | null;
};

export type ResolvedMemoryBankAuthority = {
  bank: HindsightBank;
  principalKind: "person" | "worker";
  principalId: string;
  contextSubjectId: string;
  capabilityGrantId: string;
  capability: string;
  capabilityMode: "observe" | "modify";
  dataClassificationCeiling: DataClassification;
};

export interface MemoryBankAuthorityResolver {
  resolve(
    request: MemoryBankAuthorityRequest,
  ): Promise<ResolvedMemoryBankAuthority>;
}

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

export type ContextGatewayOptions = Readonly<{
  testOnlyEnableInMemoryMutations?: boolean;
}>;

type StoredSource = Omit<AdmitSourceInput, "authority"> & SourceRevision;

const systemClock: GatewayClock = { now: () => new Date().toISOString() };

/**
 * The gateway exposes memory context only. It deliberately has no operation for
 * creating Records, Policies, capabilities, approvals, decisions, or Work.
 */
export class ContextGateway {
  readonly #hindsight: HindsightAdapter;
  readonly #authorityResolver: MemoryBankAuthorityResolver;
  readonly #clock: GatewayClock;
  readonly #testOnlyEnableInMemoryMutations: boolean;
  readonly #sources = new Map<string, StoredSource>();
  readonly #deletedSources = new Map<string, string>();
  readonly #workspaceRealms = new Map<string, InstallationRealm>();
  readonly #latestByObject = new Map<string, string>();
  readonly #lineage = new Map<string, ConsolidationLineage>();
  readonly #receipts: RetrievalReceipt[] = [];
  #receiptSequence = 0;

  constructor(
    hindsight: HindsightAdapter,
    authorityResolver: MemoryBankAuthorityResolver,
    clock: GatewayClock = systemClock,
    options: ContextGatewayOptions = {},
  ) {
    this.#hindsight = hindsight;
    this.#authorityResolver = authorityResolver;
    this.#clock = clock;
    this.#testOnlyEnableInMemoryMutations =
      options.testOnlyEnableInMemoryMutations === true;
  }

  async admit(input: AdmitSourceInput): Promise<SourceRevision> {
    this.#assertInMemoryMutationEnabled("admit");
    const request = structuredClone(input);
    const retainAuthority = await this.#resolveAuthority(
      "retain",
      request.installationId,
      request.workspaceId,
      request.installationRealm,
      request.authority.workId,
    );
    assertClassificationAllowed(
      retainAuthority.dataClassificationCeiling,
      request.classification,
    );
    this.#assertRealmCompatible(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
    const expectedBoundary = realmBoundary(request.installationRealm);
    const admissionState: AdmissionState =
      request.boundary === "mixed" || request.boundary !== expectedBoundary
        ? "quarantined"
        : "admitted";
    const objectKey = this.#objectKey(request);
    const priorId = this.#latestByObject.get(objectKey) ?? null;
    const existing = this.#sources.get(
      this.#sourceKey(request.installationId, request.workspaceId, request.id),
    );

    const { authority: _authority, ...sourceInput } = request;
    if (existing) {
      if (!isDeepStrictEqual(storedSourcePayload(existing), sourceInput)) {
        throw new Error(
          "Source revision ID conflicts with immutable source content",
        );
      }
      return stripContent(existing);
    }

    const revision: StoredSource = {
      ...structuredClone(sourceInput),
      admissionState,
      supersedesRevisionId: priorId,
      deletedAt: null,
    };

    let invalidatedAt: string | null = null;
    if (priorId) {
      const invalidateAuthority = await this.#resolveAuthority(
        "invalidate",
        request.installationId,
        request.workspaceId,
        request.installationRealm,
        request.authority.workId,
      );
      const priorSource = this.#sources.get(
        this.#sourceKey(request.installationId, request.workspaceId, priorId),
      );
      if (!priorSource) {
        throw new Error("Superseded source revision is unavailable");
      }
      assertClassificationAllowed(
        invalidateAuthority.dataClassificationCeiling,
        priorSource.classification,
      );
      invalidatedAt = this.#clock.now();
      await this.#hindsight.invalidateSource(
        invalidateAuthority.bank,
        priorId,
        invalidatedAt,
      );
    }
    if (admissionState === "admitted") {
      const admittedAuthority = priorId
        ? await this.#resolveAuthority(
            "retain",
            request.installationId,
            request.workspaceId,
            request.installationRealm,
            request.authority.workId,
          )
        : retainAuthority;
      assertClassificationAllowed(
        admittedAuthority.dataClassificationCeiling,
        request.classification,
      );
      await this.#hindsight.retain(admittedAuthority.bank, {
        id: `source:${request.id}`,
        text: request.text,
        classification: request.classification,
        citations: structuredClone(request.citations),
        sourceRevisionIds: [request.id],
        invalidatedAt: null,
      });
    }

    this.#sources.set(
      this.#sourceKey(request.installationId, request.workspaceId, request.id),
      revision,
    );
    this.#latestByObject.set(objectKey, request.id);
    if (priorId && invalidatedAt) {
      this.#markLineageInvalidated(
        request.installationId,
        request.workspaceId,
        priorId,
        invalidatedAt,
      );
    }
    this.#establishRealm(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
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
    authority: MemoryAuthorityContext;
  }): Promise<ConsolidationLineage> {
    this.#assertInMemoryMutationEnabled("consolidate");
    const request = structuredClone(input);
    const authorityResolution = await this.#resolveAuthority(
      "consolidate",
      request.installationId,
      request.workspaceId,
      request.installationRealm,
      request.authority.workId,
    );
    this.#assertRealmCompatible(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
    if (request.sourceRevisionIds.length === 0) {
      throw new Error(
        "Consolidation requires at least one canonical source revision",
      );
    }
    const effectiveSourceRevisionIds = [...request.sourceRevisionIds];
    for (const parentId of request.parentMemoryIds ?? []) {
      const parent = this.#lineage.get(
        this.#lineageKey(request.installationId, request.workspaceId, parentId),
      );
      if (
        !parent ||
        parent.installationId !== request.installationId ||
        parent.workspaceId !== request.workspaceId ||
        parent.invalidatedAt
      ) {
        throw new Error(
          `Parent memory ${parentId} is not active in this installation`,
        );
      }
      effectiveSourceRevisionIds.push(...parent.sourceRevisionIds);
    }
    const canonicalSourceRevisionIds = [...new Set(effectiveSourceRevisionIds)];
    const sources = canonicalSourceRevisionIds.map((id) => {
      const source = this.#sources.get(
        this.#sourceKey(request.installationId, request.workspaceId, id),
      );
      if (
        !source ||
        source.admissionState !== "admitted" ||
        this.#deletedSources.has(
          this.#sourceKey(request.installationId, request.workspaceId, id),
        )
      ) {
        throw new Error(
          `Source revision ${id} is not active admitted material`,
        );
      }
      if (source.installationRealm !== request.installationRealm) {
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
    assertClassificationAllowed(
      authorityResolution.dataClassificationCeiling,
      classification,
    );
    const lineage: ConsolidationLineage = {
      derivedMemoryId: request.derivedMemoryId,
      installationId: request.installationId,
      workspaceId: request.workspaceId,
      sourceRevisionIds: canonicalSourceRevisionIds,
      parentMemoryIds: [...(request.parentMemoryIds ?? [])],
      createdAt: this.#clock.now(),
      invalidatedAt: null,
    };
    await this.#hindsight.retain(authorityResolution.bank, {
      id: request.derivedMemoryId,
      text: request.text,
      classification,
      citations,
      sourceRevisionIds: canonicalSourceRevisionIds,
      invalidatedAt: null,
    });
    this.#lineage.set(
      this.#lineageKey(
        request.installationId,
        request.workspaceId,
        request.derivedMemoryId,
      ),
      lineage,
    );
    this.#establishRealm(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
    return structuredClone(lineage);
  }

  async retrieve(input: {
    installationId: string;
    workspaceId: string;
    installationRealm: InstallationRealm;
    query: string;
    authority: MemoryAuthorityContext;
  }): Promise<RetrievalResult> {
    const request = structuredClone(input);
    const authorityResolution = await this.#resolveAuthority(
      "retrieve",
      request.installationId,
      request.workspaceId,
      request.installationRealm,
      request.authority.workId,
    );
    this.#assertRealmCompatible(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
    const memories = await this.#hindsight.retrieve(
      authorityResolution.bank,
      request.query,
    );
    const revalidatedAuthority = await this.#resolveAuthority(
      "retrieve",
      request.installationId,
      request.workspaceId,
      request.installationRealm,
      request.authority.workId,
    );
    if (!sameResolvedAuthority(authorityResolution, revalidatedAuthority)) {
      throw new Error("Memory bank authority changed during retrieval");
    }
    const admittedMemories = memories.flatMap((memory) => {
      const context = this.#toUntrustedContext(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
        memory,
        revalidatedAuthority.dataClassificationCeiling,
      );
      return context ? [{ memory, context }] : [];
    });
    this.#receiptSequence += 1;
    const receipt: RetrievalReceipt = {
      id: deterministicUuid(
        `receipt:${this.#clock.now()}:${request.installationId}:${request.workspaceId}:${request.query}:${this.#receiptSequence}`,
      ),
      installationId: request.installationId,
      workspaceId: request.workspaceId,
      bankId: authorityResolution.bank.id,
      queryHash: sha256(request.query),
      resultIds: admittedMemories.map(({ memory }) => memory.id),
      sourceRevisionIds: [
        ...new Set(
          admittedMemories.flatMap(({ memory }) => memory.sourceRevisionIds),
        ),
      ],
      retrievedAt: this.#clock.now(),
    };
    this.#receipts.push(receipt);
    this.#establishRealm(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
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
    authority: MemoryAuthorityContext;
  }): Promise<void> {
    this.#assertInMemoryMutationEnabled("deleteSource");
    const request = structuredClone(input);
    const authorityResolution = await this.#resolveAuthority(
      "invalidate",
      request.installationId,
      request.workspaceId,
      request.installationRealm,
      request.authority.workId,
    );
    this.#assertRealmCompatible(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
    const source = this.#sources.get(
      this.#sourceKey(
        request.installationId,
        request.workspaceId,
        request.sourceRevisionId,
      ),
    );
    if (!source || source.installationRealm !== request.installationRealm) {
      return;
    }
    assertClassificationAllowed(
      authorityResolution.dataClassificationCeiling,
      source.classification,
    );
    const deletedAt = this.#clock.now();
    await this.#hindsight.invalidateSource(
      authorityResolution.bank,
      request.sourceRevisionId,
      deletedAt,
    );
    this.#deletedSources.set(
      this.#sourceKey(
        request.installationId,
        request.workspaceId,
        request.sourceRevisionId,
      ),
      deletedAt,
    );
    this.#markLineageInvalidated(
      request.installationId,
      request.workspaceId,
      request.sourceRevisionId,
      deletedAt,
    );
    this.#establishRealm(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
  }

  async getLineage(input: {
    installationId: string;
    workspaceId: string;
    installationRealm: InstallationRealm;
    derivedMemoryId: string;
    authority: MemoryAuthorityContext;
  }): Promise<ConsolidationLineage | null> {
    const request = structuredClone(input);
    const authorityResolution = await this.#resolveAuthority(
      "retrieve",
      request.installationId,
      request.workspaceId,
      request.installationRealm,
      request.authority.workId,
    );
    this.#assertRealmCompatible(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
    const lineage = this.#lineage.get(
      this.#lineageKey(
        request.installationId,
        request.workspaceId,
        request.derivedMemoryId,
      ),
    );
    if (
      lineage &&
      lineage.sourceRevisionIds.some((sourceRevisionId) => {
        const source = this.#sources.get(
          this.#sourceKey(
            request.installationId,
            request.workspaceId,
            sourceRevisionId,
          ),
        );
        return (
          !source ||
          !classificationAllows(
            authorityResolution.dataClassificationCeiling,
            source.classification,
          )
        );
      })
    ) {
      return null;
    }
    return lineage ? structuredClone(lineage) : null;
  }

  async getReceipts(input: {
    installationId: string;
    workspaceId: string;
    installationRealm: InstallationRealm;
    authority: MemoryAuthorityContext;
  }): Promise<RetrievalReceipt[]> {
    const request = structuredClone(input);
    const authorityResolution = await this.#resolveAuthority(
      "retrieve",
      request.installationId,
      request.workspaceId,
      request.installationRealm,
      request.authority.workId,
    );
    this.#assertRealmCompatible(
      request.installationId,
      request.workspaceId,
      request.installationRealm,
    );
    return structuredClone(
      this.#receipts.filter(
        (receipt) =>
          receipt.installationId === request.installationId &&
          receipt.workspaceId === request.workspaceId &&
          receipt.sourceRevisionIds.every((sourceRevisionId) => {
            const source = this.#sources.get(
              this.#sourceKey(
                request.installationId,
                request.workspaceId,
                sourceRevisionId,
              ),
            );
            return (
              source &&
              classificationAllows(
                authorityResolution.dataClassificationCeiling,
                source.classification,
              )
            );
          }),
      ),
    );
  }

  #markLineageInvalidated(
    installationId: string,
    workspaceId: string,
    sourceRevisionId: string,
    at: string,
  ): void {
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

  #assertInMemoryMutationEnabled(operation: string): void {
    if (!this.#testOnlyEnableInMemoryMutations) {
      throw new Error(
        `Context Gateway ${operation} is disabled without the explicit test-only in-memory mutation opt-in`,
      );
    }
  }

  async #resolveAuthority(
    operation: MemoryGatewayOperation,
    installationId: string,
    workspaceId: string,
    realm: InstallationRealm,
    workId: string | null,
  ): Promise<ResolvedMemoryBankAuthority> {
    const resolution = await this.#authorityResolver.resolve({
      operation,
      installationId,
      workspaceId,
      installationRealm: realm,
      workId,
    });
    const expected = workspaceHindsightBank(installationId, workspaceId, realm);
    if (!sameBank(resolution.bank, expected)) {
      throw new Error(
        "Resolved memory bank does not match the requested workspace and realm",
      );
    }
    return structuredClone(resolution);
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
    dataClassificationCeiling: DataClassification,
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
    const activeSources = sources.filter((source): source is StoredSource =>
      Boolean(source),
    );
    if (
      new Set(memory.sourceRevisionIds).size !== memory.sourceRevisionIds.length
    ) {
      return null;
    }
    const citationRevisionIds = memory.citations.map(
      (citation) => citation.sourceRevisionId,
    );
    if (!sameStringSet(memory.sourceRevisionIds, citationRevisionIds)) {
      return null;
    }
    const canonicalCitations = uniqueCitations(
      activeSources.flatMap((source) => source.citations),
    );
    if (!sameCitationSet(memory.citations, canonicalCitations)) return null;
    const classification = deriveDataClassification(
      activeSources.map((source) => source.classification),
    );
    if (memory.classification !== classification) return null;
    if (!classificationAllows(dataClassificationCeiling, classification)) {
      return null;
    }
    const parsed = retrievedContextSchema.safeParse({
      text: memory.text,
      trust: "untrusted",
      derived: true,
      classification,
      citations: memory.citations,
    });
    return parsed.success ? parsed.data : null;
  }

  #assertRealmCompatible(
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
  }

  #establishRealm(
    installationId: string,
    workspaceId: string,
    realm: InstallationRealm,
  ): void {
    this.#assertRealmCompatible(installationId, workspaceId, realm);
    const key = `${installationId}\u0000${workspaceId}`;
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

function stripContent(source: StoredSource): SourceRevision {
  const { text: _text, citations: _citations, ...revision } = source;
  return structuredClone(revision);
}

function storedSourcePayload(
  source: StoredSource,
): Omit<StoredSource, "admissionState" | "supersedesRevisionId" | "deletedAt"> {
  const {
    admissionState: _admissionState,
    supersedesRevisionId: _supersedesRevisionId,
    deletedAt: _deletedAt,
    ...payload
  } = source;
  return payload;
}

function sameBank(left: HindsightBank, right: HindsightBank): boolean {
  const exactKeys = ["id", "installationId", "realm", "workspaceId"];
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    sameStringArray(leftKeys, exactKeys) &&
    sameStringArray(rightKeys, exactKeys) &&
    left.id === right.id &&
    left.installationId === right.installationId &&
    left.workspaceId === right.workspaceId &&
    left.realm === right.realm
  );
}

function sameResolvedAuthority(
  left: ResolvedMemoryBankAuthority,
  right: ResolvedMemoryBankAuthority,
): boolean {
  return (
    sameBank(left.bank, right.bank) &&
    left.principalKind === right.principalKind &&
    left.principalId === right.principalId &&
    left.contextSubjectId === right.contextSubjectId &&
    left.capabilityGrantId === right.capabilityGrantId &&
    left.capability === right.capability &&
    left.capabilityMode === right.capabilityMode &&
    left.dataClassificationCeiling === right.dataClassificationCeiling
  );
}

function assertClassificationAllowed(
  ceiling: DataClassification,
  classification: DataClassification,
): void {
  if (!classificationAllows(ceiling, classification)) {
    throw new Error(
      `Memory classification ${classification} exceeds the resolved ${ceiling} ceiling`,
    );
  }
}

function classificationAllows(
  ceiling: DataClassification,
  classification: DataClassification,
): boolean {
  switch (ceiling) {
    case "restricted":
      return true;
    case "confidential":
      return ["public", "internal", "confidential", "synthetic"].includes(
        classification,
      );
    case "internal":
      return ["public", "internal", "synthetic"].includes(classification);
    case "public":
      return classification === "public" || classification === "synthetic";
    case "synthetic":
      return classification === "synthetic";
  }
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function uniqueCitations(citations: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citationKey(citation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameCitationSet(
  recalled: SourceCitation[],
  canonical: SourceCitation[],
): boolean {
  const recalledKeys = recalled.map(citationKey);
  const canonicalKeys = canonical.map(citationKey);
  const recalledSet = new Set(recalledKeys);
  const canonicalSet = new Set(canonicalKeys);
  return (
    recalledKeys.length === recalledSet.size &&
    canonicalKeys.length === canonicalSet.size &&
    recalledSet.size === canonicalSet.size &&
    [...recalledSet].every((key) => canonicalSet.has(key))
  );
}

function citationKey(citation: SourceCitation): string {
  return JSON.stringify([
    citation.sourceRevisionId,
    citation.sourceUri,
    citation.revisionHash,
    citation.locator,
  ]);
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

export * from "./database-authority.js";
