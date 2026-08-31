import type {
  Database,
  DatabaseContext,
  PersonContext,
  SqlExecutor,
} from "@vorton/database";
import type {
  AppendExecutiveRecord,
  ExecutiveLedger,
  ExecutiveRecord,
  ExecutiveWork,
} from "@vorton/executive";
import type { ExecutionAuthority, WorkInput } from "@vorton/contracts";

interface RecordRow {
  id: string;
  installation_id: string;
  workspace_id: string;
  work_id: string | null;
  kind: ExecutiveRecord["kind"];
  summary: string;
  payload: Record<string, unknown>;
  actor_person_id: string | null;
  actor_worker_id: string | null;
  supersedes_record_id: string | null;
}

function recordFromRow(row: RecordRow): ExecutiveRecord {
  const actor = row.actor_person_id
    ? ({ kind: "person", id: row.actor_person_id } as const)
    : row.actor_worker_id
      ? ({ kind: "worker", id: row.actor_worker_id } as const)
      : null;
  if (!actor) throw new Error("Executive record has no actor");
  return {
    id: row.id,
    installationId: row.installation_id,
    workspaceId: row.workspace_id,
    workId: row.work_id,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload,
    actor,
    supersedesRecordId: row.supersedes_record_id,
  };
}

const recordColumns = `id, installation_id, workspace_id, work_id, kind, summary, payload,
  actor_person_id, actor_worker_id, supersedes_record_id`;

/** Stores the executive chain in authoritative Postgres tables. */
export class DatabaseExecutiveLedger implements ExecutiveLedger {
  constructor(private readonly database: Database) {}

  append(
    record: AppendExecutiveRecord,
    context?: DatabaseContext,
  ): Promise<ExecutiveRecord> {
    return this.#withContext(context, async (transaction) => {
      const sourceUri =
        typeof record.payload.sourceUri === "string"
          ? record.payload.sourceUri
          : null;
      const classification =
        typeof record.payload.classification === "string"
          ? record.payload.classification
          : "internal";
      const result = await transaction.query<RecordRow>(
        `insert into public.records
          (installation_id, workspace_id, work_id, kind, summary, payload, source_uri,
           classification, actor_person_id, actor_worker_id, supersedes_record_id)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8,
                 case when $9 = 'person' then $10::uuid else null end,
                 case when $9 = 'worker' then $10::uuid else null end, $11)
         returning ${recordColumns}`,
        [
          record.installationId,
          record.workspaceId,
          record.workId,
          record.kind,
          record.summary,
          JSON.stringify(record.payload),
          sourceUri,
          classification,
          record.actor.kind,
          record.actor.id,
          record.supersedesRecordId ?? null,
        ],
      );
      return recordFromSingleRow(result.rows[0]);
    });
  }

  getRecord(
    id: string,
    context?: DatabaseContext,
  ): Promise<ExecutiveRecord | null> {
    return this.#withContext(context, async (transaction) => {
      const result = await transaction.query<RecordRow>(
        `select ${recordColumns} from public.records where id = $1`,
        [id],
      );
      return result.rows[0] ? recordFromRow(result.rows[0]) : null;
    });
  }

  createWork(
    input: WorkInput,
    authority: ExecutionAuthority,
    context?: PersonContext,
  ): Promise<ExecutiveWork> {
    if (!context) {
      throw new Error("A verified person context is required to create Work");
    }
    return this.database.asPerson(context, async (transaction) => {
      const id = await insertWork(transaction, input);
      return { id, input, authority };
    });
  }

  #withContext<T>(
    context: DatabaseContext | undefined,
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    if (!context) {
      throw new Error("A verified person or scoped worker context is required");
    }
    return "authUserId" in context
      ? this.database.asPerson(context, work)
      : this.database.asWorker(context, work);
  }
}

function recordFromSingleRow(row: RecordRow | undefined): ExecutiveRecord {
  if (!row)
    throw new Error("Postgres did not return the appended executive record");
  return recordFromRow(row);
}

async function insertWork(
  transaction: SqlExecutor,
  input: WorkInput,
): Promise<string> {
  const result = await transaction.query<{ id: string }>(
    `insert into public.work
      (installation_id, workspace_id, title, requested_outcome, acceptance_criteria,
       parent_work_id, priority, requested_by_person_id)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7,
             public.current_workspace_person_id($1, $2))
     returning id`,
    [
      input.installationId,
      input.workspaceId,
      input.title,
      input.requestedOutcome,
      JSON.stringify(input.acceptanceCriteria),
      input.parentWorkId ?? null,
      input.priority,
    ],
  );
  const row = result.rows[0];
  if (!row)
    throw new Error("Postgres did not return the created Work identity");
  return row.id;
}
