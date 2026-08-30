import { Pool, type PoolConfig, type QueryResultRow } from "pg";
import { createHmac } from "node:crypto";

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface PersonContext {
  authUserId: string;
  installationId: string;
}

export interface WorkerContext {
  workerId: string;
  installationId: string;
  credentialId?: string;
}

export type DatabaseContext = PersonContext | WorkerContext;

export type DatabaseConfig = PoolConfig & { contextSigningSecret: string };

export type TransactionWork<T> = (transaction: SqlExecutor) => Promise<T>;

export class Database {
  readonly #pool: Pool;
  readonly #contextSigningSecret: string;

  constructor(config: DatabaseConfig | Pool, contextSigningSecret?: string) {
    if (config instanceof Pool) {
      this.#pool = config;
      this.#contextSigningSecret = contextSigningSecret ?? "";
    } else {
      const { contextSigningSecret: secret, ...poolConfig } = config;
      this.#pool = new Pool(poolConfig);
      this.#contextSigningSecret = secret;
    }
    if (this.#contextSigningSecret.length < 32) {
      throw new Error(
        "Database context signing secret must contain at least 32 characters",
      );
    }
  }

  async asPerson<T>(
    context: PersonContext,
    work: TransactionWork<T>,
  ): Promise<T> {
    return this.#asPerson(context, work);
  }

  async asPersonAcrossInstallations<T>(
    authUserId: string,
    work: TransactionWork<T>,
  ): Promise<T> {
    return this.#asPerson({ authUserId, installationId: "*" }, work);
  }

  async #asPerson<T>(
    context: PersonContext,
    work: TransactionWork<T>,
  ): Promise<T> {
    return this.#transaction(async (client, transactionId) => {
      await this.#installContext(client, transactionId, {
        kind: "person",
        installationId: context.installationId,
        subjectId: context.authUserId,
        credentialId: "",
      });
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: context.authUserId, role: "authenticated" }),
      ]);
      return work(client);
    });
  }

  async asWorker<T>(
    context: WorkerContext,
    work: TransactionWork<T>,
  ): Promise<T> {
    return this.#transaction(async (client, transactionId) => {
      await this.#installContext(client, transactionId, {
        kind: "worker",
        installationId: context.installationId,
        subjectId: context.workerId,
        credentialId: context.credentialId ?? "",
      });
      await client.query("set local role aubos_worker");
      return work(client);
    });
  }

  async asAdministrator<T>(work: TransactionWork<T>): Promise<T> {
    return this.#transaction(work);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #installContext(
    client: SqlExecutor,
    transactionId: string,
    context: {
      kind: "person" | "worker";
      installationId: string;
      subjectId: string;
      credentialId: string;
    },
  ): Promise<void> {
    const payload = [
      transactionId,
      context.kind,
      context.installationId,
      context.subjectId,
      context.credentialId,
    ].join("|");
    const signature = createHmac("sha256", this.#contextSigningSecret)
      .update(payload)
      .digest("hex");
    await client.query(
      `select set_config('aubos.context_kind', $1, true),
              set_config('aubos.installation_id', $2, true),
              set_config('aubos.subject_id', $3, true),
              set_config('aubos.credential_id', $4, true),
              set_config('vorton.context_kind', $1, true),
              set_config('vorton.installation_id', $2, true),
              set_config('vorton.subject_id', $3, true),
              set_config('vorton.credential_id', $4, true),
              set_config('aubos.context_signature', $5, true),
              set_config('vorton.context_signature', $5, true)`,
      [
        context.kind,
        context.installationId,
        context.subjectId,
        context.credentialId,
        signature,
      ],
    );
  }

  async #transaction<T>(
    work: (transaction: SqlExecutor, transactionId: string) => Promise<T>,
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      const transaction = await client.query<{ id: string }>(
        "select txid_current()::text as id",
      );
      const transactionId = transaction.rows[0]?.id;
      if (!transactionId) {
        throw new Error("Postgres did not report a transaction ID");
      }
      const result = await work(client, transactionId);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
