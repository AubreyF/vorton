import { describe, expect, it, vi } from "vitest";

import {
  advanceExecutiveCouncil,
  getExecutiveCouncil,
  getRuntimeBootstrap,
  installExecutiveCouncil,
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
        installationSlug: "moonbase",
        installationNameBase64: "TW9vbmJhc2UgT1M=",
        supabaseUrl: "https://moonbase.supabase.co/",
        supabaseAnonKey: "sb_publishable_synthetic",
        apiUrl: "https://api.example.test/",
      }),
    ).toEqual({
      installationSlug: "moonbase",
      installationName: "Moonbase OS",
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
          installationSlug: "moonbase",
          installationNameBase64: "TW9vbmJhc2UgT1M=",
          supabaseUrl: "https://moonbase.supabase.co",
          supabaseAnonKey: "sb_publishable_synthetic",
          apiUrl: "https://api.example.test",
          ...override,
        }),
      ).toThrow("must use HTTPS");
    },
  );

  it.each([
    ["slug", { installationSlug: "Moonbase" }],
    ["name", { installationNameBase64: "not base64" }],
  ])("rejects an invalid installation %s", (_field, override) => {
    expect(() =>
      readBrowserRuntimeConfig({
        installationSlug: "moonbase",
        installationNameBase64: "TW9vbmJhc2UgT1M=",
        supabaseUrl: "https://moonbase.supabase.co",
        supabaseAnonKey: "sb_publishable_synthetic",
        apiUrl: "https://api.example.test",
        ...override,
      }),
    ).toThrow(/installation/);
  });

  it("accepts the full database display-name vocabulary and enforces its length ceiling", () => {
    const name = "St. John’s Research, Inc.";
    expect(
      readBrowserRuntimeConfig({
        installationSlug: "st-johns-research",
        installationNameBase64: Buffer.from(name).toString("base64"),
        supabaseUrl: "https://moonbase.supabase.co",
        supabaseAnonKey: "sb_publishable_synthetic",
        apiUrl: "https://api.example.test",
      }).installationName,
    ).toBe(name);

    expect(() =>
      readBrowserRuntimeConfig({
        installationSlug: "oversized-name",
        installationNameBase64: Buffer.from("a".repeat(121)).toString("base64"),
        supabaseUrl: "https://moonbase.supabase.co",
        supabaseAnonKey: "sb_publishable_synthetic",
        apiUrl: "https://api.example.test",
      }),
    ).toThrow("1 to 120 characters");
  });

  it("does not fall back to installation-specific Vite build variables", () => {
    const runtimeGlobal = globalThis as typeof globalThis & {
      __VORTON_RUNTIME_CONFIG__?: unknown;
    };
    const previous = runtimeGlobal.__VORTON_RUNTIME_CONFIG__;
    delete runtimeGlobal.__VORTON_RUNTIME_CONFIG__;
    try {
      expect(() => readBrowserRuntimeConfig()).toThrow(
        "Public runtime configuration is unavailable",
      );
    } finally {
      runtimeGlobal.__VORTON_RUNTIME_CONFIG__ = previous;
    }
  });

  it("forwards only the verified session bearer token to governed executive routes", async () => {
    const requestFetch = vi.fn(async () => Response.json({ id: "proposal-1" }));
    await postExecutiveRequest(
      "https://api.vorton.example",
      "verified-session-token",
      "reviews",
      { proposalRecordId: "synthetic" },
      requestFetch as typeof fetch,
    );
    expect(requestFetch).toHaveBeenCalledWith(
      "https://api.vorton.example/v1/executive/reviews",
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
      "https://api.vorton.example",
      "verified-session-token",
      requestFetch as typeof fetch,
    );
    expect(requestFetch).toHaveBeenCalledWith(
      "https://api.vorton.example/v1/runtime/bootstrap",
      { headers: { authorization: "Bearer verified-session-token" } },
    );
  });

  it("routes council reads with the exact bearer token and installation query", async () => {
    const requestFetch = vi.fn(async () =>
      Response.json({
        protocol: "vorton.executive-council.v1",
        installationId: "installation-1",
        workspaceId: "workspace-1",
      }),
    );
    await getExecutiveCouncil(
      "https://api.vorton.example",
      "verified-session-token",
      "work/with spaces",
      "installation-1",
      "workspace-1",
      requestFetch as typeof fetch,
    );
    expect(requestFetch).toHaveBeenCalledWith(
      "https://api.vorton.example/v1/executive/councils/work%2Fwith%20spaces?installationId=installation-1&workspaceId=workspace-1",
      { headers: { authorization: "Bearer verified-session-token" } },
    );
  });

  it.each([
    ["install", installExecutiveCouncil],
    ["advance", advanceExecutiveCouncil],
  ] as const)(
    "routes council %s with the exact bearer token and installation body",
    async (action, request) => {
      const requestFetch = vi.fn(async () =>
        Response.json({
          protocol: "vorton.executive-council.v1",
          installationId: "installation-1",
          workspaceId: "workspace-1",
        }),
      );
      await request(
        "https://api.vorton.example",
        "verified-session-token",
        "work-1",
        "installation-1",
        "workspace-1",
        requestFetch as typeof fetch,
      );
      expect(requestFetch).toHaveBeenCalledWith(
        `https://api.vorton.example/v1/executive/councils/work-1/${action}`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer verified-session-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            installationId: "installation-1",
            workspaceId: "workspace-1",
          }),
        },
      );
    },
  );

  it("rejects a council response bound to another workspace", async () => {
    const requestFetch = vi.fn(async () =>
      Response.json({
        protocol: "vorton.executive-council.v1",
        installationId: "installation-1",
        workspaceId: "workspace-other",
      }),
    );

    await expect(
      getExecutiveCouncil(
        "https://api.vorton.example",
        "verified-session-token",
        "work-1",
        "installation-1",
        "workspace-1",
        requestFetch as typeof fetch,
      ),
    ).rejects.toThrow("different workspace");
  });
});
