import type {
  DataClassification,
  ExecutiveWorkerJob,
  ExecutiveWorkerJobRequest,
} from "@aubos/contracts";
import { executiveWorkerJobSchema } from "@aubos/contracts";
import type { ExecutiveWorkerProvider } from "@aubos/workers";

export interface RemoteWorkerConfig {
  url: string;
  secret: string;
  provider: string;
  model: string;
  dataClassificationCeiling: DataClassification;
  fetch?: typeof fetch;
}

export class RemoteExecutiveWorkerAdapter implements ExecutiveWorkerProvider {
  readonly provider: string;
  readonly model: string;
  readonly dataClassificationCeiling: DataClassification;
  readonly #url: string;
  readonly #secret: string;
  readonly #fetch: typeof fetch;

  constructor(config: RemoteWorkerConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.dataClassificationCeiling = config.dataClassificationCeiling;
    this.#url = config.url;
    this.#secret = config.secret;
    this.#fetch = config.fetch ?? fetch;
  }

  submit(request: ExecutiveWorkerJobRequest): Promise<ExecutiveWorkerJob> {
    return this.#request("/internal/v1/jobs", { request });
  }

  retrieve(_job: ExecutiveWorkerJob): Promise<ExecutiveWorkerJob> {
    return Promise.reject(
      new Error("Stateless worker responses cannot be retrieved"),
    );
  }

  async #request(path: string, body: unknown): Promise<ExecutiveWorkerJob> {
    const response = await this.#fetch(`${this.#url}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`Worker service failed with HTTP ${response.status}`);
    }
    return executiveWorkerJobSchema.parse(await response.json());
  }
}
