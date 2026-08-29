import type {
  DataClassification,
  InstallationRealm,
  SourceCitation,
} from "@aubos/contracts";

export type HindsightBank = {
  id: string;
  installationId: string;
  realm: InstallationRealm;
};

/** One deterministic Hindsight routing identity per installation and realm. */
export function installationHindsightBank(
  installationId: string,
  realm: InstallationRealm,
): HindsightBank {
  if (!installationId.trim()) throw new Error("Installation ID is required");
  return {
    id: `${realm}:${installationId}:default`,
    installationId,
    realm,
  };
}

export type HindsightMemory = {
  id: string;
  text: string;
  classification: DataClassification;
  citations: SourceCitation[];
  sourceRevisionIds: string[];
  invalidatedAt: string | null;
};

export interface HindsightAdapter {
  ensureBank(bank: HindsightBank): Promise<void>;
  retain(bank: HindsightBank, memory: HindsightMemory): Promise<void>;
  retrieve(bank: HindsightBank, query: string): Promise<HindsightMemory[]>;
  invalidateSource(
    bank: HindsightBank,
    sourceRevisionId: string,
    at: string,
  ): Promise<void>;
}

/**
 * Deterministic test adapter. Its map keys include both installation and realm so
 * a caller cannot accidentally alias a personal bank to an organization bank.
 */
export class InMemoryHindsightAdapter implements HindsightAdapter {
  readonly #banks = new Map<string, Map<string, HindsightMemory>>();

  async ensureBank(bank: HindsightBank): Promise<void> {
    const key = this.#key(bank);
    if (!this.#banks.has(key)) this.#banks.set(key, new Map());
  }

  async retain(bank: HindsightBank, memory: HindsightMemory): Promise<void> {
    await this.ensureBank(bank);
    this.#banks.get(this.#key(bank))!.set(memory.id, structuredClone(memory));
  }

  async retrieve(
    bank: HindsightBank,
    query: string,
  ): Promise<HindsightMemory[]> {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const memories = [...(this.#banks.get(this.#key(bank))?.values() ?? [])];
    return memories
      .filter((memory) => memory.invalidatedAt === null)
      .filter(
        (memory) =>
          terms.length === 0 ||
          terms.some((term) => memory.text.toLocaleLowerCase().includes(term)),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((memory) => structuredClone(memory));
  }

  async invalidateSource(
    bank: HindsightBank,
    sourceRevisionId: string,
    at: string,
  ): Promise<void> {
    for (const memory of this.#banks.get(this.#key(bank))?.values() ?? []) {
      if (memory.sourceRevisionIds.includes(sourceRevisionId)) {
        memory.invalidatedAt = at;
      }
    }
  }

  #key(bank: HindsightBank): string {
    if (!bank.id.startsWith(`${bank.realm}:${bank.installationId}:`)) {
      throw new Error(
        "Hindsight bank identity does not match its installation realm",
      );
    }
    return `${bank.realm}\u0000${bank.installationId}\u0000${bank.id}`;
  }
}

export * from "./http.js";
