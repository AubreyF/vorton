import {
  executiveWorkerJobRequestSchema,
  executiveWorkerJobSchema,
  type ExecutiveWorkerJob,
  type ExecutiveWorkerJobRequest,
} from "@vorton/contracts";
import type { Database, WorkerContext } from "@vorton/database";

/**
 * Persists provider job identity and status through the worker RLS boundary.
 * Structured model output is deliberately excluded from this table.
 */
export class WorkerRunsService {
  constructor(private readonly database: Database) {}

  async recordSubmitted(
    context: WorkerContext,
    rawRequest: ExecutiveWorkerJobRequest,
    rawJob: ExecutiveWorkerJob,
  ): Promise<string> {
    const request = executiveWorkerJobRequestSchema.parse(rawRequest);
    const job = executiveWorkerJobSchema.parse(rawJob);
    if (
      request.installationId !== context.installationId ||
      request.workerId !== context.workerId ||
      job.installationId !== request.installationId ||
      job.workId !== request.workId ||
      job.workerId !== request.workerId
    ) {
      throw new Error(
        "Worker run cannot cross its credential or Work boundary",
      );
    }
    return this.database.asWorker(context, async (transaction) => {
      const result = await transaction.query<{ id: string }>(
        `insert into public.worker_runs
          (installation_id, work_id, worker_id, role_id, provider, model,
           provider_job_id, status, store, background, metadata, error)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
         returning id`,
        [
          request.installationId,
          request.workId,
          request.workerId,
          request.role.roleId,
          job.provider,
          job.model,
          job.jobId,
          job.status,
          job.store,
          job.background,
          JSON.stringify({
            installation_id: request.installationId,
            work_id: request.workId,
            worker_id: request.workerId,
            role_sha256: request.role.contentSha256,
            role_version: String(request.role.version),
          }),
          job.error ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Worker run identity was not recorded");
      return row.id;
    });
  }

  updateStatus(
    context: WorkerContext,
    rawJob: ExecutiveWorkerJob,
  ): Promise<void> {
    const job = executiveWorkerJobSchema.parse(rawJob);
    if (
      job.installationId !== context.installationId ||
      job.workerId !== context.workerId
    ) {
      throw new Error("Worker run status cannot cross its credential boundary");
    }
    return this.database.asWorker(context, async (transaction) => {
      const result = await transaction.query(
        `update public.worker_runs
            set status = $4, error = $5
          where installation_id = $1 and worker_id = $2 and provider_job_id = $3`,
        [
          context.installationId,
          context.workerId,
          job.jobId,
          job.status,
          job.error ?? null,
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error("Worker run identity was not found");
      }
    });
  }
}
