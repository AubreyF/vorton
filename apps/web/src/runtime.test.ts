import { describe, expect, it, vi } from "vitest";

import {
  getRuntimeBootstrap,
  postExecutiveRequest,
  readBrowserRuntimeConfig,
} from "./runtime.js";

describe("browser runtime boundary", () => {
  it("fails closed when public Supabase or API configuration is missing", () => {
    expect(() => readBrowserRuntimeConfig({})).toThrow("are required");
  });

  it("reads validated public configuration injected at container startup", () => {
    expect(
      readBrowserRuntimeConfig({
        supabaseUrl: "https://moonbase.supabase.co/",
        supabaseAnonKey: "sb_publishable_synthetic",
        apiUrl: "https://api.example.test/",
      }),
    ).toEqual({
      supabaseUrl: "https://moonbase.supabase.co",
      supabaseAnonKey: "sb_publishable_synthetic",
      apiUrl: "https://api.example.test",
    });
  });

  it.each([
    ["Supabase", { supabaseUrl: "http://supabase.example.test" }],
    ["API", { apiUrl: "http://api.example.test" }],
  ])(
    "requires HTTPS for the %s service outside local development",
    (_name, override) => {
      expect(() =>
        readBrowserRuntimeConfig({
          supabaseUrl: "https://moonbase.supabase.co",
          supabaseAnonKey: "sb_publishable_synthetic",
          apiUrl: "https://api.example.test",
          ...override,
        }),
      ).toThrow("must use HTTPS");
    },
  );

  it("does not fall back to installation-specific Vite build variables", () => {
    const runtimeGlobal = globalThis as typeof globalThis & {
      __AUBOS_RUNTIME_CONFIG__?: unknown;
    };
    const previous = runtimeGlobal.__AUBOS_RUNTIME_CONFIG__;
    delete runtimeGlobal.__AUBOS_RUNTIME_CONFIG__;
    try {
      expect(() => readBrowserRuntimeConfig()).toThrow(
        "Public runtime configuration is unavailable",
      );
    } finally {
      runtimeGlobal.__AUBOS_RUNTIME_CONFIG__ = previous;
    }
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
