import { describe, expect, it, vi } from "vitest";

import {
  advanceExecutiveCouncil,
  getExecutiveCouncil,
  getRuntimeBootstrap,
  installExecutiveCouncil,
  postExecutiveRequest,
  readBrowserRuntimeConfig,
  type ExecutiveCouncilState,
} from "./runtime.js";
import {
  previewCouncilScope,
  previewCouncilStates,
} from "./executive-council.preview.js";

function councilState(): ExecutiveCouncilState {
  return structuredClone(previewCouncilStates.ready);
}

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
      previewCouncilScope.installationId,
      previewCouncilScope.workspaceId,
      {
        proposalRecordId: "synthetic",
        installationId: "forged-installation",
        workspaceId: "forged-workspace",
      },
      requestFetch as typeof fetch,
    );
    expect(requestFetch).toHaveBeenCalledWith(
      "https://api.vorton.example/v1/executive/reviews",
      expect.objectContaining({
        headers: {
          authorization: "Bearer verified-session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          proposalRecordId: "synthetic",
          installationId: previewCouncilScope.installationId,
          workspaceId: previewCouncilScope.workspaceId,
        }),
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
    const requestFetch = vi.fn(async () => Response.json(councilState()));
    await getExecutiveCouncil(
      "https://api.vorton.example",
      "verified-session-token",
      previewCouncilScope.workId,
      previewCouncilScope.installationId,
      previewCouncilScope.workspaceId,
      { requestFetch: requestFetch as typeof fetch },
    );
    expect(requestFetch).toHaveBeenCalledWith(
      `https://api.vorton.example/v1/executive/councils/${previewCouncilScope.workId}?installationId=${previewCouncilScope.installationId}&workspaceId=${previewCouncilScope.workspaceId}`,
      { headers: { authorization: "Bearer verified-session-token" } },
    );
  });

  it.each([
    ["install", installExecutiveCouncil],
    ["advance", advanceExecutiveCouncil],
  ] as const)(
    "routes council %s with the exact bearer token and installation body",
    async (action, request) => {
      const requestFetch = vi.fn(async () => Response.json(councilState()));
      await request(
        "https://api.vorton.example",
        "verified-session-token",
        previewCouncilScope.workId,
        previewCouncilScope.installationId,
        previewCouncilScope.workspaceId,
        { requestFetch: requestFetch as typeof fetch },
      );
      expect(requestFetch).toHaveBeenCalledWith(
        `https://api.vorton.example/v1/executive/councils/${previewCouncilScope.workId}/${action}`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer verified-session-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            installationId: previewCouncilScope.installationId,
            workspaceId: previewCouncilScope.workspaceId,
          }),
        },
      );
    },
  );

  it("rejects a council response bound to another workspace", async () => {
    const response = councilState();
    response.workspaceId = "00000000-0000-4000-8000-000000000099";
    const requestFetch = vi.fn(async () => Response.json(response));

    await expect(
      getExecutiveCouncil(
        "https://api.vorton.example",
        "verified-session-token",
        previewCouncilScope.workId,
        previewCouncilScope.installationId,
        previewCouncilScope.workspaceId,
        { requestFetch: requestFetch as typeof fetch },
      ),
    ).rejects.toThrow("different workspace");
  });

  it("rejects invalid, wrong-Work, and cross-workspace nested council state", async () => {
    const invalidFetch = vi.fn(async () =>
      Response.json({
        protocol: "vorton.executive-council.v1",
        installationId: previewCouncilScope.installationId,
        workspaceId: previewCouncilScope.workspaceId,
      }),
    );
    await expect(
      getExecutiveCouncil(
        "https://api.vorton.example",
        "verified-session-token",
        previewCouncilScope.workId,
        previewCouncilScope.installationId,
        previewCouncilScope.workspaceId,
        { requestFetch: invalidFetch as typeof fetch },
      ),
    ).rejects.toThrow("invalid state");

    const wrongWork = councilState();
    wrongWork.work.id = "00000000-0000-4000-8000-000000000098";
    await expect(
      getExecutiveCouncil(
        "https://api.vorton.example",
        "verified-session-token",
        previewCouncilScope.workId,
        previewCouncilScope.installationId,
        previewCouncilScope.workspaceId,
        {
          requestFetch: vi.fn(async () => Response.json(wrongWork)),
        },
      ),
    ).rejects.toThrow("different workspace or Work item");

    const nested: ExecutiveCouncilState = structuredClone(
      previewCouncilStates.recommendations,
    );
    nested.roles[0]!.proposal!.workspaceId =
      "00000000-0000-4000-8000-000000000099";
    await expect(
      getExecutiveCouncil(
        "https://api.vorton.example",
        "verified-session-token",
        previewCouncilScope.workId,
        previewCouncilScope.installationId,
        previewCouncilScope.workspaceId,
        {
          requestFetch: vi.fn(async () => Response.json(nested)),
        },
      ),
    ).rejects.toThrow("nested record for a different workspace");
  });
});
