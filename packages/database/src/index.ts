import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow,
} from "pg";

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
  credentialId: string;
}

export type TransactionWork<T> = (transaction: SqlExecutor) => Promise<T>;

export class Database {
  readonly #pool: Pool;

  constructor(config: PoolConfig | Pool) {
    this.#pool = config instanceof Pool ? config : new Pool(config);
  }

  async asPerson<T>(
    context: PersonContext,
    work: TransactionWork<T>,
  ): Promise<T> {
    return this.#transaction(async (client) => {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: context.authUserId,
          role: "authenticated",
          installation_id: context.installationId,
        }),
      ]);
      return work(client);
    });
  }

  async asWorker<T>(
    context: WorkerContext,
    work: TransactionWork<T>,
  ): Promise<T> {
    return this.#transaction(async (client) => {
      await client.query("set local role aubos_worker");
      await client.query("select set_config('aubos.worker_id', $1, true)", [
        context.workerId,
      ]);
      await client.query(
        "select set_config('aubos.installation_id', $1, true)",
        [context.installationId],
      );
      await client.query("select set_config('aubos.credential_id', $1, true)", [
        context.credentialId,
      ]);
      return work(client);
    });
  }

  async asAdministrator<T>(work: TransactionWork<T>): Promise<T> {
    return this.#transaction(work);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #transaction<T>(work: TransactionWork<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
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
