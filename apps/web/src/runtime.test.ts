import { describe, expect, it, vi } from "vitest";

import {
  getRuntimeBootstrap,
  postExecutiveRequest,
  readBrowserRuntimeConfig,
} from "./runtime.js";

describe("browser runtime boundary", () => {
  it("fails closed when public Supabase or API configuration is missing", () => {
    expect(() => readBrowserRuntimeConfig({} as ImportMetaEnv)).toThrow(
      "are required",
    );
  });

  it("forwards only the verified session bearer token to governed executive routes", async () => {
    const requestFetch = vi.fn(async () => Response.json({ id: "proposal-1" }));
    await postExecutiveRequest(
      "https://api.aubos.example",
      "verified-session-token",
      "reviews",
      { proposalRecordId: "synthetic" },
      requestFetch as typeof fetch,
    );
    expect(requestFetch).toHaveBeenCalledWith(
      "https://api.aubos.example/v1/executive/reviews",
      expect.objectContaining({
        headers: {
          authorization: "Bearer verified-session-token",
          "content-type": "application/json",
        },
      }),
    );
  });

  it("loads the caller bootstrap using the verified session bearer token", async () => {
    const requestFetch = vi.fn(async () =>
      Response.json({ installations: [] }),
    );
    await getRuntimeBootstrap(
      "https://api.aubos.example",
      "verified-session-token",
      requestFetch as typeof fetch,
    );
    expect(requestFetch).toHaveBeenCalledWith(
      "https://api.aubos.example/v1/runtime/bootstrap",
      { headers: { authorization: "Bearer verified-session-token" } },
    );
  });
});
