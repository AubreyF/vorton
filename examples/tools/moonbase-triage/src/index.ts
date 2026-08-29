export type MoonbaseIncident = {
  id: string;
  system: string;
  summary: string;
  urgency: 1 | 2 | 3;
  impact: 1 | 2 | 3;
};

export type TriagedIncident = MoonbaseIncident & {
  score: number;
  lane: "Immediate" | "Next watch" | "Monitor";
};

export const moonbaseIncidents: readonly MoonbaseIncident[] = [
  {
    id: "MB-07",
    system: "Airlock C",
    summary: "Pressure seal oscillation",
    urgency: 3,
    impact: 3,
  },
  {
    id: "MB-12",
    system: "Greenhouse",
    summary: "Irrigation pump drift",
    urgency: 2,
    impact: 2,
  },
  {
    id: "MB-19",
    system: "Rover Bay",
    summary: "Inventory beacon overdue",
    urgency: 1,
    impact: 1,
  },
  {
    id: "MB-22",
    system: "Power Ring",
    summary: "Battery temperature variance",
    urgency: 2,
    impact: 3,
  },
];

/** Pure, stable, offline rule used by the preview and its tests. */
export function triageMoonbaseIncidents(
  incidents: readonly MoonbaseIncident[],
): TriagedIncident[] {
  return incidents
    .map((incident) => {
      const score = incident.urgency * 2 + incident.impact;
      const lane: TriagedIncident["lane"] =
        score >= 8 ? "Immediate" : score >= 5 ? "Next watch" : "Monitor";
      return { ...incident, score, lane };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
