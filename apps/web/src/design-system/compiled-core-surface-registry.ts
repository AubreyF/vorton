import { workspaceCompiledCoreSurfaceRegistry } from "@vorton/contracts";

export type CompiledCoreSurfaceId =
  | "command"
  | "opportunities"
  | "goals"
  | "tasks"
  | "tools"
  | "factory"
  | "admin";

export type CompiledCoreSurfaceComponent =
  "command" | "foundation" | "tasks" | "tools" | "read-only-factory";

export interface CompiledCoreSurfaceProjection {
  id: string;
  contractVersion: string;
  label: string;
  navigationOrder: number;
  presentationVariant: string;
}

export interface WorkspaceCoreSurfaceProjection {
  defaultModuleId: string | null;
  modules: CompiledCoreSurfaceProjection[];
}

export interface CoreSurfaceSelectionReceiptReference {
  receiptId: string;
  receiptSha256: string;
}

export interface CompiledCoreSurfaceDefinition {
  id: CompiledCoreSurfaceId;
  contractVersion: "v1";
  label: string;
  presentationVariant: "standard" | "read-only";
  component: CompiledCoreSurfaceComponent;
  subsections: readonly string[];
  legacyRouteIds?: readonly string[];
  singleLevelNavigation: boolean;
}

export interface ResolvedCoreSurface {
  definition: CompiledCoreSurfaceDefinition;
  label: string;
  navigationOrder: number;
}

export type WorkspaceCoreSurfaceResolution =
  | {
      state: "ready";
      modules: readonly ResolvedCoreSurface[];
      defaultModule: ResolvedCoreSurface;
    }
  | {
      state: "unconfigured";
      modules: readonly [];
    }
  | {
      state: "upgrade-required" | "invalid" | "unsupported";
      modules: readonly [];
    };

export interface ResolvedCoreSurfaceRoute {
  module: ResolvedCoreSurface;
  subsection: string;
}

const compiledCoreSurfaceDefinitions: readonly CompiledCoreSurfaceDefinition[] =
  [
    {
      ...compiledRegistrySurface("command"),
      component: "command",
      subsections: ["Briefing", "Council", "Decisions", "Activity"],
      singleLevelNavigation: true,
    },
    {
      ...compiledRegistrySurface("opportunities"),
      component: "foundation",
      subsections: ["Workbench", "Selected", "Signals", "Pipeline"],
      singleLevelNavigation: false,
    },
    {
      ...compiledRegistrySurface("goals"),
      component: "foundation",
      subsections: ["Active", "Guardrails", "Execution", "Calendar"],
      singleLevelNavigation: false,
    },
    {
      ...compiledRegistrySurface("tasks"),
      component: "tasks",
      subsections: ["Priority", "Blocked", "All open", "History"],
      singleLevelNavigation: false,
    },
    {
      ...compiledRegistrySurface("tools"),
      component: "tools",
      subsections: ["Catalog", "moonbase-triage"],
      singleLevelNavigation: true,
    },
    {
      ...compiledRegistrySurface("factory"),
      component: "read-only-factory",
      subsections: ["Tickets", "Workers", "Pull requests", "Receipts"],
      singleLevelNavigation: false,
    },
    {
      ...compiledRegistrySurface("admin"),
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

function compiledRegistrySurface(id: CompiledCoreSurfaceId) {
  const surface = workspaceCompiledCoreSurfaceRegistry.surfaces.find(
    (candidate) => candidate.id === id,
  );
  if (!surface) throw new Error(`Compiled core surface ${id} is unavailable`);
  return surface;
}

const definitionByTuple = new Map(
  compiledCoreSurfaceDefinitions.map((definition) => [
    tupleKey(definition),
    definition,
  ]),
);

export function resolveWorkspaceCoreSurface(
  projection: WorkspaceCoreSurfaceProjection | unknown,
  state: "unconfigured" | "selected" | "upgrade-required" | "invalid" | unknown,
  selectionReceipt: CoreSurfaceSelectionReceiptReference | null | unknown,
): WorkspaceCoreSurfaceResolution {
  if (!isWorkspaceCoreSurfaceProjection(projection)) {
    return { state: "unsupported", modules: [] };
  }
  if (state === "upgrade-required" || state === "invalid") {
    return projection.modules.length === 0 &&
      projection.defaultModuleId === null &&
      selectionReceipt === null
      ? { state, modules: [] }
      : { state: "unsupported", modules: [] };
  }
  if (state === "unconfigured") {
    return projection.modules.length === 0 &&
      projection.defaultModuleId === null &&
      selectionReceipt === null
      ? { state: "unconfigured", modules: [] }
      : { state: "unsupported", modules: [] };
  }
  if (
    state !== "selected" ||
    projection.modules.length === 0 ||
    projection.defaultModuleId === null ||
    !isCoreSurfaceSelectionReceiptReference(selectionReceipt)
  ) {
    return { state: "unsupported", modules: [] };
  }

  const seenIds = new Set<string>();
  const resolved: ResolvedCoreSurface[] = [];
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
      label: definition.label,
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

function isCoreSurfaceSelectionReceiptReference(
  value: unknown,
): value is CoreSurfaceSelectionReceiptReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.receiptId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      candidate.receiptId,
    ) &&
    typeof candidate.receiptSha256 === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(candidate.receiptSha256) &&
    Object.keys(candidate).length === 2
  );
}

export function resolveWorkspaceCoreSurfaceRoute(
  surface: WorkspaceCoreSurfaceResolution,
  hash: string,
): ResolvedCoreSurfaceRoute | null {
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
  surface: WorkspaceCoreSurfaceResolution,
  currentRoute: ResolvedCoreSurfaceRoute | null,
): ResolvedCoreSurfaceRoute | null {
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

export function workspaceCoreSurfaceRouteHash(
  route: ResolvedCoreSurfaceRoute | null,
): string {
  if (!route) return "";
  return `#${route.module.definition.id}/${encodeURIComponent(route.subsection)}`;
}

export function supportedCompiledCoreSurfaceDefinition(
  id: CompiledCoreSurfaceId,
): CompiledCoreSurfaceDefinition {
  return compiledCoreSurfaceDefinitions.find(
    (definition) => definition.id === id,
  )!;
}

export function supportedCompiledCoreSurfaceId(
  routeId: string,
): CompiledCoreSurfaceId | undefined {
  return compiledCoreSurfaceDefinitions.find(
    (definition) =>
      definition.id === routeId || definition.legacyRouteIds?.includes(routeId),
  )?.id;
}

function tupleKey(module: {
  id: string;
  contractVersion: string;
  label: string;
  presentationVariant: string;
}) {
  return `${module.id}\u0000${module.contractVersion}\u0000${module.label}\u0000${module.presentationVariant}`;
}

function isWorkspaceCoreSurfaceProjection(
  value: unknown,
): value is WorkspaceCoreSurfaceProjection {
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
