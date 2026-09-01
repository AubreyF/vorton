import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceModuleRoute,
  resolveWorkspaceModuleSurface,
  resolveWorkspaceSwitchRoute,
  workspaceModuleRouteHash,
  type WorkspaceModuleSurfaceProjection,
} from "./workspace-module-registry.js";

const freedSurface = {
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
      presentationVariant: "freed-read-only",
    },
  ],
} satisfies WorkspaceModuleSurfaceProjection;

describe("workspace module registry", () => {
  it("switches from FreedOS to an empty AubOS surface without retaining a module route", () => {
    const freed = resolveWorkspaceModuleSurface(freedSurface);
    const current = resolveWorkspaceModuleRoute(freed, "#factory/Workers");
    const aubos = resolveWorkspaceModuleSurface({
      defaultModuleId: null,
      modules: [],
    });

    expect(current?.module.definition.component).toBe(
      "freed-read-only-factory",
    );
    expect(aubos.state).toBe("unconfigured");
    expect(resolveWorkspaceSwitchRoute(aubos, current)).toBeNull();
    expect(
      workspaceModuleRouteHash(resolveWorkspaceSwitchRoute(aubos, current)),
    ).toBe("");
  });

  it("does not resolve or mount Factory when the target workspace does not enable it", () => {
    const target = resolveWorkspaceModuleSurface({
      defaultModuleId: "command",
      modules: freedSurface.modules.filter((module) => module.id !== "factory"),
    });
    const route = resolveWorkspaceModuleRoute(target, "#factory/Workers");

    expect(target.state).toBe("ready");
    expect(route).toBeNull();
    expect(
      target.modules.some(
        (module) => module.definition.component === "freed-read-only-factory",
      ),
    ).toBe(false);
  });

  it("uses the default only for an empty route, never for an explicit unknown route", () => {
    const target = resolveWorkspaceModuleSurface(freedSurface);

    expect(resolveWorkspaceModuleRoute(target, "")?.module.definition.id).toBe(
      "command",
    );
    expect(resolveWorkspaceModuleRoute(target, "#unknown/Anything")).toBeNull();
  });

  it("fails the entire surface closed for an unknown presentation variant", () => {
    const target = resolveWorkspaceModuleSurface({
      ...freedSurface,
      modules: freedSurface.modules.map((module) =>
        module.id === "factory"
          ? { ...module, presentationVariant: "generic" }
          : module,
      ),
    });

    expect(target).toEqual({ state: "unsupported", modules: [] });
    expect(resolveWorkspaceModuleRoute(target, "#command/Briefing")).toBeNull();
  });

  it("fails closed when an older runtime omits the projection", () => {
    expect(resolveWorkspaceModuleSurface(undefined)).toEqual({
      state: "unsupported",
      modules: [],
    });
    expect(
      resolveWorkspaceModuleSurface({
        defaultModuleId: "command",
        modules: [{ id: "command" }],
      }),
    ).toEqual({ state: "unsupported", modules: [] });
  });

  it("retains an enabled route and otherwise replaces it with the target default", () => {
    const source = resolveWorkspaceModuleSurface(freedSurface);
    const tasks = resolveWorkspaceModuleRoute(source, "#tasks/Blocked");
    const target = resolveWorkspaceModuleSurface({
      defaultModuleId: "command",
      modules: freedSurface.modules.filter((module) => module.id !== "factory"),
    });
    expect(
      workspaceModuleRouteHash(resolveWorkspaceSwitchRoute(target, tasks)),
    ).toBe("#tasks/Blocked");

    const factory = resolveWorkspaceModuleRoute(source, "#factory/Receipts");
    expect(
      workspaceModuleRouteHash(resolveWorkspaceSwitchRoute(target, factory)),
    ).toBe("#command/Briefing");
  });
});
