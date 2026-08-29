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
  requestTimeoutMs: number;
  fetch?: typeof fetch;
}

export class RemoteExecutiveWorkerAdapter implements ExecutiveWorkerProvider {
  readonly provider: string;
  readonly model: string;
  readonly dataClassificationCeiling: DataClassification;
  readonly #url: string;
  readonly #secret: string;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;

  constructor(config: RemoteWorkerConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.dataClassificationCeiling = config.dataClassificationCeiling;
    this.#url = config.url;
    this.#secret = config.secret;
    this.#fetch = config.fetch ?? fetch;
    if (
      !Number.isInteger(config.requestTimeoutMs) ||
      config.requestTimeoutMs < 60_000 ||
      config.requestTimeoutMs > 1_860_000
    ) {
      throw new Error(
        "Worker request timeout must be an integer from 60000 through 1860000 milliseconds",
      );
    }
    this.#requestTimeoutMs = config.requestTimeoutMs;
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
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.#requestTimeoutMs);
    timeout.unref();
    try {
      const response = await this.#fetch(`${this.#url}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Worker service failed with HTTP ${response.status}`);
      }
      return executiveWorkerJobSchema.parse(await response.json());
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Worker service exceeded its request timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
