import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerServer } from "./server.js";

const secret = "s".repeat(32);
const servers: ReturnType<typeof createWorkerServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("stateless worker boundary", () => {
  it("does not expose a provider retrieval route", async () => {
    const retrieve = vi.fn();
    const server = createWorkerServer({
      secret,
      provider: {
        provider: "openai-responses",
        model: "synthetic-model",
        dataClassificationCeiling: "synthetic",
        storesResponses: false,
        submit: vi.fn(),
        retrieve,
      },
      release: "synthetic-test",
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/internal/v1/jobs/job-1`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(404);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
