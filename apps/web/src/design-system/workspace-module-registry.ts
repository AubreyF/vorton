export type WorkspaceModuleId =
  | "command"
  | "opportunities"
  | "goals"
  | "tasks"
  | "tools"
  | "factory"
  | "admin";

export type WorkspaceModuleComponent =
  "command" | "foundation" | "tasks" | "tools" | "freed-read-only-factory";

export interface WorkspaceModuleProjection {
  id: string;
  contractVersion: string;
  label: string;
  navigationOrder: number;
  presentationVariant: string;
}

export interface WorkspaceModuleSurfaceProjection {
  defaultModuleId: string | null;
  modules: WorkspaceModuleProjection[];
}

export interface WorkspaceModuleDefinition {
  id: WorkspaceModuleId;
  contractVersion: "v1";
  presentationVariant: "standard" | "freed-read-only";
  component: WorkspaceModuleComponent;
  subsections: readonly string[];
  legacyRouteIds?: readonly string[];
  singleLevelNavigation: boolean;
}

export interface ResolvedWorkspaceModule {
  definition: WorkspaceModuleDefinition;
  label: string;
  navigationOrder: number;
}

export type WorkspaceModuleSurfaceResolution =
  | {
      state: "ready";
      modules: readonly ResolvedWorkspaceModule[];
      defaultModule: ResolvedWorkspaceModule;
    }
  | {
      state: "unconfigured";
      modules: readonly [];
    }
  | {
      state: "unsupported";
      modules: readonly [];
    };

export interface ResolvedWorkspaceModuleRoute {
  module: ResolvedWorkspaceModule;
  subsection: string;
}

const workspaceModuleDefinitions: readonly WorkspaceModuleDefinition[] = [
  {
    id: "command",
    contractVersion: "v1",
    presentationVariant: "standard",
    component: "command",
    subsections: ["Briefing", "Council", "Decisions", "Activity"],
    singleLevelNavigation: true,
  },
  {
    id: "opportunities",
    contractVersion: "v1",
    presentationVariant: "standard",
    component: "foundation",
    subsections: ["Workbench", "Selected", "Signals", "Pipeline"],
    singleLevelNavigation: false,
  },
  {
    id: "goals",
    contractVersion: "v1",
    presentationVariant: "standard",
    component: "foundation",
    subsections: ["Active", "Guardrails", "Execution", "Calendar"],
    singleLevelNavigation: false,
  },
  {
    id: "tasks",
    contractVersion: "v1",
    presentationVariant: "standard",
    component: "tasks",
    subsections: ["Priority", "Blocked", "All open", "History"],
    singleLevelNavigation: false,
  },
  {
    id: "tools",
    contractVersion: "v1",
    presentationVariant: "standard",
    component: "tools",
    subsections: ["Catalog", "moonbase-triage"],
    singleLevelNavigation: true,
  },
  {
    id: "factory",
    contractVersion: "v1",
    presentationVariant: "freed-read-only",
    component: "freed-read-only-factory",
    subsections: ["Tickets", "Workers", "Pull requests", "Receipts"],
    singleLevelNavigation: false,
  },
  {
    id: "admin",
    contractVersion: "v1",
    presentationVariant: "standard",
    component: "foundation",
    subsections: [
      "People",
      "Workers",
      "Policy",
      "Records",
      "Conversations",
      "Sources",
    ],
    legacyRouteIds: ["conversations"],
    singleLevelNavigation: false,
  },
] as const;

const definitionByTuple = new Map(
  workspaceModuleDefinitions.map((definition) => [
    tupleKey(definition),
    definition,
  ]),
);

export function resolveWorkspaceModuleSurface(
  projection: WorkspaceModuleSurfaceProjection | unknown,
): WorkspaceModuleSurfaceResolution {
  if (!isWorkspaceModuleSurfaceProjection(projection)) {
    return { state: "unsupported", modules: [] };
  }
  if (projection.modules.length === 0 && projection.defaultModuleId === null) {
    return { state: "unconfigured", modules: [] };
  }
  if (projection.modules.length === 0 || projection.defaultModuleId === null) {
    return { state: "unsupported", modules: [] };
  }

  const seenIds = new Set<string>();
  const resolved: ResolvedWorkspaceModule[] = [];
  for (const module of projection.modules) {
    if (
      seenIds.has(module.id) ||
      !module.label.trim() ||
      !Number.isSafeInteger(module.navigationOrder)
    ) {
      return { state: "unsupported", modules: [] };
    }
    seenIds.add(module.id);
    const definition = definitionByTuple.get(tupleKey(module));
    if (!definition) return { state: "unsupported", modules: [] };
    resolved.push({
      definition,
      label: module.label,
      navigationOrder: module.navigationOrder,
    });
  }

  resolved.sort(
    (left, right) =>
      left.navigationOrder - right.navigationOrder ||
      left.definition.id.localeCompare(right.definition.id),
  );
  const defaultModule = resolved.find(
    (module) => module.definition.id === projection.defaultModuleId,
  );
  if (!defaultModule) return { state: "unsupported", modules: [] };
  return { state: "ready", modules: resolved, defaultModule };
}

export function resolveWorkspaceModuleRoute(
  surface: WorkspaceModuleSurfaceResolution,
  hash: string,
): ResolvedWorkspaceModuleRoute | null {
  if (surface.state !== "ready") return null;
  const [requestedModuleId = "", encodedSubsection] = hash
    .replace(/^#/, "")
    .split("/");
  const requestedModule = surface.modules.find(
    (module) =>
      module.definition.id === requestedModuleId ||
      module.definition.legacyRouteIds?.includes(requestedModuleId),
  );
  if (requestedModuleId && !requestedModule) return null;
  const module = requestedModule ?? surface.defaultModule;
  const requestedSubsection = decodeRouteSegment(encodedSubsection);
  const subsection = module.definition.subsections.includes(requestedSubsection)
    ? requestedSubsection
    : module.definition.subsections[0]!;
  return { module, subsection };
}

export function resolveWorkspaceSwitchRoute(
  surface: WorkspaceModuleSurfaceResolution,
  currentRoute: ResolvedWorkspaceModuleRoute | null,
): ResolvedWorkspaceModuleRoute | null {
  if (surface.state !== "ready") return null;
  const retained = currentRoute
    ? surface.modules.find(
        (module) => module.definition.id === currentRoute.module.definition.id,
      )
    : undefined;
  const module = retained ?? surface.defaultModule;
  const subsection =
    retained && module.definition.subsections.includes(currentRoute!.subsection)
      ? currentRoute!.subsection
      : module.definition.subsections[0]!;
  return { module, subsection };
}

export function workspaceModuleRouteHash(
  route: ResolvedWorkspaceModuleRoute | null,
): string {
  if (!route) return "";
  return `#${route.module.definition.id}/${encodeURIComponent(route.subsection)}`;
}

export function supportedWorkspaceModuleDefinition(
  id: WorkspaceModuleId,
): WorkspaceModuleDefinition {
  return workspaceModuleDefinitions.find((definition) => definition.id === id)!;
}

export function supportedWorkspaceModuleId(
  routeId: string,
): WorkspaceModuleId | undefined {
  return workspaceModuleDefinitions.find(
    (definition) =>
      definition.id === routeId || definition.legacyRouteIds?.includes(routeId),
  )?.id;
}

function tupleKey(module: {
  id: string;
  contractVersion: string;
  presentationVariant: string;
}) {
  return `${module.id}\u0000${module.contractVersion}\u0000${module.presentationVariant}`;
}

function isWorkspaceModuleSurfaceProjection(
  value: unknown,
): value is WorkspaceModuleSurfaceProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const projection = value as {
    defaultModuleId?: unknown;
    modules?: unknown;
  };
  if (
    projection.defaultModuleId !== null &&
    typeof projection.defaultModuleId !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(projection.modules)) return false;
  return projection.modules.every((module) => {
    if (!module || typeof module !== "object" || Array.isArray(module)) {
      return false;
    }
    const candidate = module as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.contractVersion === "string" &&
      typeof candidate.label === "string" &&
      Number.isSafeInteger(candidate.navigationOrder) &&
      typeof candidate.presentationVariant === "string"
    );
  });
}

function decodeRouteSegment(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
