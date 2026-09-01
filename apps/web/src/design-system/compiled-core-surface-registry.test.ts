import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceCoreSurfaceRoute,
  resolveWorkspaceCoreSurface,
  resolveWorkspaceSwitchRoute,
  workspaceCoreSurfaceRouteHash,
  type WorkspaceCoreSurfaceProjection,
} from "./compiled-core-surface-registry.js";

const organizationalSurface = {
  defaultModuleId: "command",
  modules: [
    {
      id: "command",
      contractVersion: "v1",
      label: "Command Bridge",
      navigationOrder: 10,
      presentationVariant: "standard",
    },
    {
      id: "tasks",
      contractVersion: "v1",
      label: "Tasks",
      navigationOrder: 20,
      presentationVariant: "standard",
    },
    {
      id: "factory",
      contractVersion: "v1",
      label: "Factory",
      navigationOrder: 30,
      presentationVariant: "read-only",
    },
  ],
} satisfies WorkspaceCoreSurfaceProjection;

const selectionReceipt = {
  receiptId: "10000000-0000-4000-8000-000000000001",
  receiptSha256: `sha256:${"a".repeat(64)}`,
};

describe("compiled core-surface registry", () => {
  it("switches from an organizational surface to an empty personal surface without retaining a route", () => {
    const organizational = resolveWorkspaceCoreSurface(
      organizationalSurface,
      "selected",
      selectionReceipt,
    );
    const current = resolveWorkspaceCoreSurfaceRoute(
      organizational,
      "#factory/Workers",
    );
    const personal = resolveWorkspaceCoreSurface(
      { defaultModuleId: null, modules: [] },
      "unconfigured",
      null,
    );

    expect(current?.module.definition.component).toBe("read-only-factory");
    expect(personal.state).toBe("unconfigured");
    expect(resolveWorkspaceSwitchRoute(personal, current)).toBeNull();
    expect(
      workspaceCoreSurfaceRouteHash(
        resolveWorkspaceSwitchRoute(personal, current),
      ),
    ).toBe("");
  });

  it("does not resolve or mount Factory when the target workspace does not enable it", () => {
    const target = resolveWorkspaceCoreSurface(
      {
        defaultModuleId: "command",
        modules: organizationalSurface.modules.filter(
          (module) => module.id !== "factory",
        ),
      },
      "selected",
      selectionReceipt,
    );
    const route = resolveWorkspaceCoreSurfaceRoute(target, "#factory/Workers");

    expect(target.state).toBe("ready");
    expect(route).toBeNull();
    expect(
      target.modules.some(
        (module) => module.definition.component === "read-only-factory",
      ),
    ).toBe(false);
  });

  it("uses the default only for an empty route, never for an explicit unknown route", () => {
    const target = resolveWorkspaceCoreSurface(
      organizationalSurface,
      "selected",
      selectionReceipt,
    );

    expect(
      resolveWorkspaceCoreSurfaceRoute(target, "")?.module.definition.id,
    ).toBe("command");
    expect(
      resolveWorkspaceCoreSurfaceRoute(target, "#unknown/Anything"),
    ).toBeNull();
  });

  it("fails the entire surface closed for an unknown presentation variant", () => {
    const target = resolveWorkspaceCoreSurface(
      {
        ...organizationalSurface,
        modules: organizationalSurface.modules.map((module) =>
          module.id === "factory"
            ? { ...module, presentationVariant: "generic" }
            : module,
        ),
      },
      "selected",
      selectionReceipt,
    );

    expect(target).toEqual({ state: "unsupported", modules: [] });
    expect(
      resolveWorkspaceCoreSurfaceRoute(target, "#command/Briefing"),
    ).toBeNull();
  });

  it("fails closed when a runtime projection tries to rename a compiled surface", () => {
    const target = resolveWorkspaceCoreSurface(
      {
        ...organizationalSurface,
        modules: organizationalSurface.modules.map((module) =>
          module.id === "tasks" ? { ...module, label: "Whatever" } : module,
        ),
      },
      "selected",
      selectionReceipt,
    );

    expect(target).toEqual({ state: "unsupported", modules: [] });
  });

  it("fails closed when an older runtime omits the projection", () => {
    expect(
      resolveWorkspaceCoreSurface(undefined, undefined, undefined),
    ).toEqual({
      state: "unsupported",
      modules: [],
    });
    expect(
      resolveWorkspaceCoreSurface(
        { defaultModuleId: "command", modules: [{ id: "command" }] },
        undefined,
        undefined,
      ),
    ).toEqual({ state: "unsupported", modules: [] });
  });

  it("does not render selected bytes without the exact selection receipt", () => {
    expect(
      resolveWorkspaceCoreSurface(organizationalSurface, "selected", null),
    ).toEqual({ state: "unsupported", modules: [] });
  });

  it("represents unreconciled legacy state without emitting a surface", () => {
    expect(
      resolveWorkspaceCoreSurface(
        { defaultModuleId: null, modules: [] },
        "upgrade-required",
        null,
      ),
    ).toEqual({ state: "upgrade-required", modules: [] });
  });

  it("retains an enabled route and otherwise replaces it with the target default", () => {
    const source = resolveWorkspaceCoreSurface(
      organizationalSurface,
      "selected",
      selectionReceipt,
    );
    const tasks = resolveWorkspaceCoreSurfaceRoute(source, "#tasks/Blocked");
    const target = resolveWorkspaceCoreSurface(
      {
        defaultModuleId: "command",
        modules: organizationalSurface.modules.filter(
          (module) => module.id !== "factory",
        ),
      },
      "selected",
      selectionReceipt,
    );
    expect(
      workspaceCoreSurfaceRouteHash(resolveWorkspaceSwitchRoute(target, tasks)),
    ).toBe("#tasks/Blocked");

    const factory = resolveWorkspaceCoreSurfaceRoute(
      source,
      "#factory/Receipts",
    );
    expect(
      workspaceCoreSurfaceRouteHash(
        resolveWorkspaceSwitchRoute(target, factory),
      ),
    ).toBe("#command/Briefing");
  });
});
