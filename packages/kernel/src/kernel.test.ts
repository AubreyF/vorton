import { describe, expect, it } from "vitest";

import type { Database, SqlExecutor } from "@vorton/database";

import {
  PolicyService,
  RecordsService,
  RolesService,
  WorkService,
  WorkersService,
} from "./kernel.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const personId = "7fb46f09-3894-4c24-933c-77c7a403341c";
const workerId = "b5611dc4-07e4-4388-a7d0-ddf7bb452499";
const authUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5";
const credentialId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";

class FakeDatabase {
  readonly statements: Array<{ text: string; values?: readonly unknown[] }> =
    [];
  readonly responses: Array<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }> = [];

  readonly transaction: SqlExecutor = {
    query: async <Row>(text: string, values?: readonly unknown[]) => {
      this.statements.push({ text, values });
      return (this.responses.shift() ?? { rows: [], rowCount: 1 }) as {
        rows: Row[];
        rowCount: number | null;
      };
    },
  };

  asPerson<T>(
    _context: unknown,
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return work(this.transaction);
  }

  asWorker<T>(
    _context: unknown,
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return work(this.transaction);
  }

  asAdministrator<T>(
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return work(this.transaction);
  }
}

const actor = { installationId, workspaceId, authUserId };

function ownerRow() {
  return {
    id: personId,
    installation_id: installationId,
    auth_user_id: authUserId,
    display_name: "Synthetic Owner",
    kind: "owner",
    created_at: new Date("2026-08-28T12:00:00.000Z"),
  };
}

describe("worker credentials", () => {
  it("issues only a hash to Postgres and returns the secret once", async () => {
    const fake = new FakeDatabase();
    fake.responses.push({ rows: [ownerRow()], rowCount: 1 });
    fake.responses.push({ rows: [{ id: credentialId }], rowCount: 1 });
    const service = new WorkersService(fake as unknown as Database, {
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      randomToken: () => "synthetic-worker-token-with-more-than-32-characters",
    });

    const result = await service.issueCredential(actor, workerId, 300);

    expect(result).toEqual({
      credentialId,
      token: "synthetic-worker-token-with-more-than-32-characters",
      tokenHint: "aracters",
      expiresAt: "2026-08-28T12:05:00.000Z",
    });
    const insert = fake.statements[1];
    expect(insert?.text).toContain("decode($4, 'hex')");
    expect(insert?.values?.[3]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert?.values).not.toContain(result.token);
  });

  it("rejects credentials longer than the database ceiling", async () => {
    const service = new WorkersService(
      new FakeDatabase() as unknown as Database,
    );
    await expect(service.issueCredential(actor, workerId, 901)).rejects.toThrow(
      "between 1 and 900 seconds",
    );
  });
});

describe("authority boundaries", () => {
  it("scopes Work inspection to the authenticated installation", async () => {
    const fake = new FakeDatabase();
    await new WorkService(fake as unknown as Database).list(actor);
    expect(fake.statements[0]?.text).toContain("where installation_id = $1");
    expect(fake.statements[0]?.values).toEqual([installationId, workspaceId]);
  });

  it("assigning a role touches no capability grant", async () => {
    const fake = new FakeDatabase();
    fake.responses.push({ rows: [{ id: credentialId }], rowCount: 1 });
    await new RolesService(fake as unknown as Database).assign(
      actor,
      workerId,
      personId,
    );
    expect(fake.statements).toHaveLength(1);
    expect(fake.statements[0]?.text).toContain("worker_role_assignments");
    expect(fake.statements[0]?.text).not.toContain("capability_grants");
  });

  it("records expose append but no mutation operation", async () => {
    const fake = new FakeDatabase();
    fake.responses.push({ rows: [{ id: credentialId }], rowCount: 1 });
    await new RecordsService(fake as unknown as Database).appendAsPerson(
      actor,
      {
        installationId,
        workspaceId,
        kind: "evidence",
        summary: "Synthetic evidence",
        payload: { fixture: true },
        classification: "synthetic",
        workId: null,
        sourceUri: null,
        supersedesRecordId: null,
      },
    );
    expect(fake.statements[0]?.text.trim().toLowerCase()).toMatch(
      /^insert into public\.records/,
    );
  });

  it("capability grants reject a different installation", async () => {
    const service = new PolicyService(
      new FakeDatabase() as unknown as Database,
    );
    await expect(
      service.grant(actor, {
        installationId: "36bb264a-668f-45a6-8da0-6e5cad3fc026",
        workspaceId,
        policyId: personId,
        principalKind: "worker",
        principalId: workerId,
        capability: "factory.issue.update",
        mode: "modify",
        workId: null,
        expiresAt: null,
      }),
    ).rejects.toThrow("cannot cross installations");
  });
});
