import type { ExecutiveWorkerJobRequest } from "@aubos/contracts";
import { describe, expect, it, vi } from "vitest";

import { RemoteExecutiveWorkerAdapter } from "./remote-worker.js";

function adapter(fetchImplementation: typeof fetch, requestTimeoutMs = 60_000) {
  return new RemoteExecutiveWorkerAdapter({
    url: "http://synthetic-worker.internal:8080",
    secret: "s".repeat(32),
    provider: "codex-subscription",
    model: "synthetic-model",
    dataClassificationCeiling: "synthetic",
    requestTimeoutMs,
    fetch: fetchImplementation,
  });
}

describe("RemoteExecutiveWorkerAdapter", () => {
  it("aborts a worker request at its configured boundary", async () => {
    vi.useFakeTimers();
    try {
      let receivedSignal: AbortSignal | undefined;
      const fetchImplementation = vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            receivedSignal = init?.signal ?? undefined;
            receivedSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      ) as unknown as typeof fetch;
      const submitted = adapter(fetchImplementation, 930_000).submit(
        {} as ExecutiveWorkerJobRequest,
      );
      const rejection = expect(submitted).rejects.toThrow(
        "Worker service exceeded its request timeout",
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(receivedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(870_000);

      await rejection;
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unsafe timeout configuration before making a request", () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;

    expect(() => adapter(fetchImplementation, 59_999)).toThrow(
      "Worker request timeout must be an integer",
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
