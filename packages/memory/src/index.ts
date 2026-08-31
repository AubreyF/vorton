import type { DataClassification, SourceCitation } from "@vorton/contracts";

import { assertHindsightBank, type HindsightBank } from "./bank.js";

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
 * Deterministic test adapter. Its map keys include installation, workspace, and
 * realm so callers cannot alias one workspace or realm to another.
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
    assertHindsightBank(bank);
    return `${bank.realm}\u0000${bank.installationId}\u0000${bank.workspaceId}\u0000${bank.id}`;
  }
}

export * from "./bank.js";
export * from "./http.js";
