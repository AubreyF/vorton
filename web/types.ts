// Profile admission is enforced by the server registry; records carry its exact ID.
export type Profile = string;
export type Role = string;
export type CouncilConfig = {
  moduleId: string;
  moduleVersion: number;
  profile: Profile;
  identities: { id: string; name: string; title: string; mandate: string; voice: string; expertise: string; blindSpot: string; challenge: string; fictional: boolean; inherited: boolean }[];
  behavior: { focus: string; decisionCriteria: string; maxRecommendations: number; challengeRounds: number; reportSections: string[] };
};
export type GoalFields = {
  title: string;
  intent: string;
  successCriteria: string;
  owner: string;
  horizon: string;
  priority: string;
  parentId: string;
  reviewOn: string;
  milestones: { title: string; done: boolean }[];
  evidence: string;
  progress: number;
  status: string;
};
export type TaskFields = {
  title: string;
  notes: string;
  goalId: string;
  owner: string;
  dueOn: string;
  status: string;
  priority: string;
};
export type EntityMeta = {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  history: { version: number; at: string; fields: Record<string, unknown> }[];
};
export type Goal = GoalFields & EntityMeta;
export type Task = TaskFields & EntityMeta;
export type OpportunityFields = {title:string;owner:string;contact:string;kind:'booking'|'event'|'partnership';status:'new'|'qualified'|'proposed'|'won'|'lost';valueCents:number;nextAction:string;followUpOn:string;notes:string;goalId:string};
export type Opportunity = OpportunityFields & EntityMeta;
export type LedgerFields = {title:string;kind:'income'|'expense';amountCents:number;date:string;category:string;notes:string};
export type LedgerEntry = LedgerFields & EntityMeta;
export type FinancePlan = {openingCashCents:number;rooms:number;days:number;occupancy:number;rateCents:number;variableCents:number;fixedCents:number};
export type Recommendation = {
  id: string;
  role: Role;
  kind: "goal" | "task" | "goal-review" | "task-review";
  targetId: string;
  targetVersion: number | null;
  rationale: string;
  tradeoffs: string;
  confidence: string;
  evidence: string;
  proposal: GoalFields | TaskFields;
  status: string;
  ownerNote?: string;
  resultId?: string;
  createdAt: string;
};
export type State = {
  council?: CouncilConfig;
  canonical?: {
    goals: Record<string, string>[];
    tasks: Record<string, string>[];
  };
  sourceSummary?: { snapshotDate: string; goals: number; tasks: number };
  profile: Profile;
  revision: number;
  goals: Goal[];
  tasks: Task[];
  opportunities?: Opportunity[];
  ledger?: LedgerEntry[];
  financePlan?: FinancePlan;
  settings?: {defaultOwner:string;purpose:string};
  recommendations: Recommendation[];
  councilSessions?: {
    id: string;
    status: "published";
    publishedAt: string;
    basedOnRevision: number;
    evidenceDigest: string;
    summary: string;
    summaryDeferred?: boolean;
    recommendationIds: string[];
    council?: CouncilConfig;
    options?: {title:string;status:string;rationale:string;evidence:string}[];
  }[];
  events: {
    id: string;
    at: string;
    action: string;
    subjectId: string;
    actor: string;
    detail: string;
    revision: number;
  }[];
};
