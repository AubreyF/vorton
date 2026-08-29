import {
  executiveWorkerJobRequestSchema,
  executiveWorkerJobSchema,
  type ExecutiveWorkerJob,
  type ExecutiveWorkerJobRequest,
} from "@aubos/contracts";
import type { Database } from "@aubos/database";

/** Persists provider identity after the API verifies every job boundary. */
export class DatabaseWorkerRunRecorder {
  constructor(private readonly database: Database) {}

  async record(
    rawRequest: ExecutiveWorkerJobRequest,
    rawJob: ExecutiveWorkerJob,
  ): Promise<string> {
    const request = executiveWorkerJobRequestSchema.parse(rawRequest);
    const job = executiveWorkerJobSchema.parse(rawJob);
    if (
      job.installationId !== request.installationId ||
      job.workId !== request.workId ||
      job.workerId !== request.workerId
    ) {
      throw new Error(
        "Worker run crossed its installation, Work, or worker boundary",
      );
    }
    return this.database.asWorker(
      {
        installationId: request.installationId,
        workerId: request.workerId,
      },
      async (transaction) => {
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
      },
    );
  }
}
