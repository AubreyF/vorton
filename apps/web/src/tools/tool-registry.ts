export type ToolId = "moonbase-triage";

export type ToolDefinition = {
  id: ToolId;
  label: string;
  description: string;
  status: "example" | "ready";
};

export const toolRegistry: readonly ToolDefinition[] = [
  {
    id: "moonbase-triage",
    label: "Moonbase Triage",
    description:
      "Sort synthetic lunar incidents with fixed, offline urgency and impact rules.",
    status: "example",
  },
];

export function toolFromRoute(route: string): ToolDefinition | null {
  return toolRegistry.find((tool) => tool.id === route) ?? null;
}
