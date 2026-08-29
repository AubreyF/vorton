export type PersonSummary = {
  id: string;
  name: string;
  role: string;
  authority: "owner" | "operator" | "observer";
  state: "active" | "invited";
};

export type WorkerSummary = {
  id: string;
  name: string;
  runtime: string;
  model: string;
  health: "healthy" | "degraded" | "offline";
  custody: string;
  capability: string;
  lastSeen: string;
};

export type WorkSummary = {
  id: string;
  title: string;
  state: "proposed" | "ready" | "leased" | "blocked" | "review" | "completed";
  owner: string;
  module: string;
  updatedAt: string;
  evidenceCount: number;
};

export type RecordSummary = {
  id: string;
  kind:
    "evidence" | "proposal" | "decision" | "approval" | "receipt" | "outcome";
  title: string;
  source: string;
  recordedAt: string;
};

export type ModuleSummary = {
  id: string;
  name: string;
  description: string;
  state: "ready" | "preview" | "quiet";
  countLabel: string;
};

export type ControlPlaneSnapshot = {
  installation: {
    name: string;
    mode: "synthetic";
    region: string;
    release: string;
  };
  people: PersonSummary[];
  workers: WorkerSummary[];
  work: WorkSummary[];
  records: RecordSummary[];
  modules: ModuleSummary[];
  installedTools: [];
};

/**
 * The web shell reads through this boundary. A Postgres-backed implementation can
 * replace the fixture without teaching presentation components about persistence.
 */
export interface ControlPlaneDataSource {
  getSnapshot(): Promise<ControlPlaneSnapshot>;
  createWork(input: { title: string; module: string }): Promise<WorkSummary>;
}

const snapshot: ControlPlaneSnapshot = {
  installation: {
    name: "Moonbase Lab",
    mode: "synthetic",
    region: "Local",
    release: "wave-1",
  },
  people: [
    {
      id: "person-ada",
      name: "Ada North",
      role: "Installation owner",
      authority: "owner",
      state: "active",
    },
    {
      id: "person-ravi",
      name: "Ravi Chen",
      role: "Operations reviewer",
      authority: "operator",
      state: "active",
    },
    {
      id: "person-mara",
      name: "Mara Bell",
      role: "Evidence observer",
      authority: "observer",
      state: "invited",
    },
  ],
  workers: [
    {
      id: "worker-orbit",
      name: "Orbit One",
      runtime: "Local container",
      model: "Synthetic fixture",
      health: "healthy",
      custody: "Unassigned",
      capability: "Observe · Diagnose",
      lastSeen: "Now",
    },
    {
      id: "worker-relay",
      name: "Relay Seven",
      runtime: "Cloud runner",
      model: "Synthetic fixture",
      health: "degraded",
      custody: "WORK-104",
      capability: "Observe · Recommend",
      lastSeen: "8 min",
    },
    {
      id: "worker-cairn",
      name: "Cairn",
      runtime: "Offline host",
      model: "Synthetic fixture",
      health: "offline",
      custody: "None",
      capability: "Verify",
      lastSeen: "2 hr",
    },
  ],
  work: [
    {
      id: "WORK-104",
      title: "Reconcile launch readiness evidence",
      state: "leased",
      owner: "Relay Seven",
      module: "Goals",
      updatedAt: "8 min",
      evidenceCount: 3,
    },
    {
      id: "WORK-103",
      title: "Review lunar supply risk register",
      state: "review",
      owner: "Ada North",
      module: "Opportunities",
      updatedAt: "24 min",
      evidenceCount: 7,
    },
    {
      id: "WORK-102",
      title: "Define communications quiet hours",
      state: "blocked",
      owner: "Ravi Chen",
      module: "Admin",
      updatedAt: "1 hr",
      evidenceCount: 1,
    },
    {
      id: "WORK-101",
      title: "Catalogue landing-site records",
      state: "completed",
      owner: "Orbit One",
      module: "Records",
      updatedAt: "Yesterday",
      evidenceCount: 12,
    },
  ],
  records: [
    {
      id: "REC-417",
      kind: "evidence",
      title: "Launch checklist revision 3",
      source: "WORK-104",
      recordedAt: "8 min",
    },
    {
      id: "REC-416",
      kind: "approval",
      title: "Risk review may proceed",
      source: "Ada North",
      recordedAt: "31 min",
    },
    {
      id: "REC-415",
      kind: "decision",
      title: "Quiet hours require owner approval",
      source: "WORK-102",
      recordedAt: "1 hr",
    },
    {
      id: "REC-414",
      kind: "outcome",
      title: "Landing records catalogued",
      source: "WORK-101",
      recordedAt: "Yesterday",
    },
  ],
  modules: [
    {
      id: "command",
      name: "Command Bridge",
      description:
        "Ask, inspect, and propose without smuggling authority through conversation.",
      state: "ready",
      countLabel: "Ready",
    },
    {
      id: "opportunities",
      name: "Opportunities",
      description:
        "Investigate possibilities before they graduate into commitments.",
      state: "ready",
      countLabel: "3 open",
    },
    {
      id: "goals",
      name: "Goals",
      description:
        "Hold desired outcomes beside their evidence and accountable owners.",
      state: "ready",
      countLabel: "4 active",
    },
    {
      id: "tasks",
      name: "Tasks",
      description:
        "A personal view over governed Work, never a second task authority.",
      state: "ready",
      countLabel: "6 yours",
    },
    {
      id: "finance",
      name: "Finance",
      description:
        "Model resources and costs without weakening approval boundaries.",
      state: "quiet",
      countLabel: "No connection",
    },
    {
      id: "tools",
      name: "Tools",
      description:
        "Installation-owned utilities, definitions, previews, and permissions.",
      state: "preview",
      countLabel: "0 installed",
    },
    {
      id: "conversations",
      name: "Conversations",
      description:
        "Provider-neutral transcript evidence with source revision history.",
      state: "quiet",
      countLabel: "No adapters",
    },
    {
      id: "admin",
      name: "Admin",
      description:
        "People, access, policy, integrations, and deployment observations.",
      state: "ready",
      countLabel: "2 notices",
    },
    {
      id: "factory",
      name: "Factory",
      description:
        "Software production through the same Work, Policy, Records, and workers.",
      state: "preview",
      countLabel: "Pilot pending",
    },
  ],
  installedTools: [],
};

export function createSyntheticControlPlaneDataSource(): ControlPlaneDataSource {
  let current = structuredClone(snapshot);
  return {
    async getSnapshot() {
      return structuredClone(current);
    },
    async createWork(input) {
      const work: WorkSummary = {
        id: `WORK-${105 + current.work.length - snapshot.work.length}`,
        title: input.title,
        state: "proposed",
        owner: "Unassigned",
        module: input.module,
        updatedAt: "Now",
        evidenceCount: 0,
      };
      current = { ...current, work: [work, ...current.work] };
      return structuredClone(work);
    },
  };
}
