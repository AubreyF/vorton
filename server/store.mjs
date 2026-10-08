import { mkdir, readFile, open, rename, lstat, rmdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { coreIdentities, loadCouncil } from "../modules/council/config.mjs";

export const roles = Object.freeze(coreIdentities.map(x => x.id));
export class Fault extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function check(condition, message, status = 400) {
  if (!condition) throw new Fault(status, message);
}
export function text(value, name, limit = 4000, required = true) {
  check(
    typeof value === "string" &&
      value.length <= limit &&
      (!required || value.trim().length > 0),
    `Invalid ${name}`,
  );
  return value.trim();
}
const choose = (v, set, name) => {
  check(set.includes(v), `Invalid ${name}`);
  return v;
};
const timestamp = () => new Date().toISOString();
function deadline(v) {
  if (v === "" || v === undefined) return "";
  check(
    typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
  return v;
}
function fields(value, allowed) {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected an object",
  );
  check(
    Object.keys(value).every((k) => allowed.includes(k)),
    "Unexpected field",
  );
}
export function labelsInput(value = []) {
  check(Array.isArray(value) && value.length <= 30, "Use at most 30 labels");
  return [...new Set(value.map(v => text(v, "label", 80)))];
}
const organizationFields = ["projects", "tags", "ideaIds"];
const organized = input => ({projects: labelsInput(input.projects), tags: labelsInput(input.tags), ideaIds: labelsInput(input.ideaIds)});
export const ideaFields = ["title", "description", "owner", "status", "projects", "tags", "value", "complexity", "effort", "upkeep", "confidence", "pull", "startCondition", "experiment", "reviewOn", "evidence", "goalIds"];
export function ideaInput(input) {
  fields(input, ideaFields);
  const band = key => choose(input[key] ?? "unknown", ["unknown", "low", "medium", "high"], key);
  return {
    title: text(input.title, "title", 180), description: text(input.description ?? "", "description", 8000, false),
    owner: text(input.owner ?? "Owner", "owner", 120),
    status: choose(input.status ?? "inbox", ["inbox", "exploring", "ready", "parked", "graduated", "archived"], "idea status"),
    projects: labelsInput(input.projects), tags: labelsInput(input.tags),
    value: band("value"), complexity: band("complexity"), effort: band("effort"), upkeep: band("upkeep"), confidence: band("confidence"), pull: band("pull"),
    startCondition: text(input.startCondition ?? "", "start condition", 4000, false),
    experiment: text(input.experiment ?? "", "smallest useful test", 4000, false),
    reviewOn: deadline(input.reviewOn), evidence: text(input.evidence ?? "", "evidence", 12000, false),
    goalIds: labelsInput(input.goalIds),
  };
}
export function legacyIdea(row) {
  return {...ideaInput({title: row.title, owner: row.owner, description: row.notes ?? "",
    status: ({new:"inbox",qualified:"exploring",proposed:"ready",won:"graduated",lost:"archived"})[row.status] ?? "inbox",
    experiment: row.nextAction ?? "", reviewOn: row.followUpOn ?? "", goalIds: row.goalId ? [row.goalId] : []}),
    id: row.id, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, history: row.history ?? [],
    original: row.notes || row.title, legacy: row};
}
export function goalInput(input) {
  fields(input, [
    ...organizationFields,
    "title",
    "intent",
    "successCriteria",
    "owner",
    "horizon",
    "priority",
    "parentId",
    "reviewOn",
    "milestones",
    "evidence",
    "progress",
    "status",
  ]);
  const progress = input.progress ?? 0;
  check(
    Number.isInteger(progress) && progress >= 0 && progress <= 100,
    "Progress must be 0 to 100",
  );
  const milestones = input.milestones ?? [];
  check(
    Array.isArray(milestones) && milestones.length <= 30,
    "Invalid milestones",
  );
  return {
    ...organized(input),
    title: text(input.title, "title", 180),
    intent: text(input.intent ?? "", "intent", 4000, false),
    successCriteria: text(
      input.successCriteria ?? "",
      "success criteria",
      4000,
      false,
    ),
    owner: text(input.owner ?? "Owner", "owner", 120),
    horizon: text(input.horizon ?? "", "horizon", 160, false),
    priority: choose(
      input.priority ?? "normal",
      ["high", "normal", "low"],
      "priority",
    ),
    parentId: text(input.parentId ?? "", "parent goal", 80, false),
    reviewOn: deadline(input.reviewOn),
    milestones: milestones.map((m) => {
      fields(m, ["title", "done"]);
      check(typeof m.done === "boolean", "Invalid milestone state");
      return { title: text(m.title, "milestone", 240), done: m.done };
    }),
    evidence: text(input.evidence ?? "", "evidence", 12000, false),
    progress,
    status: choose(
      input.status ?? "active",
      ["active", "paused", "achieved", "retired"],
      "goal status",
    ),
  };
}
function integer(value,name,min,max) {
  check(Number.isSafeInteger(value)&&value>=min&&value<=max,`Invalid ${name}`);
  return value;
}
export function opportunityInput(input) {
  fields(input,['title','owner','contact','kind','status','valueCents','nextAction','followUpOn','notes','goalId']);
  return {title:text(input.title,'title',180),owner:text(input.owner,'owner',120),contact:text(input.contact??'','contact',160,false),kind:choose(input.kind,['booking','event','partnership'],'opportunity kind'),status:choose(input.status,['new','qualified','proposed','won','lost'],'opportunity status'),valueCents:integer(input.valueCents,'estimated value',0,10000000000),nextAction:text(input.nextAction??'','next action',500,false),followUpOn:deadline(input.followUpOn),notes:text(input.notes??'','notes',4000,false),goalId:text(input.goalId??'','goal',80,false)};
}
export function entryInput(input) {
  fields(input,['title','kind','amountCents','date','category','notes']);
  const date=deadline(input.date);check(date,'A ledger date is required');
  return {title:text(input.title,'title',180),kind:choose(input.kind,['income','expense'],'entry kind'),amountCents:integer(input.amountCents,'amount',1,10000000000),date,category:text(input.category,'category',120),notes:text(input.notes??'','notes',4000,false)};
}
export function financePlanInput(input) {
  fields(input,['openingCashCents','rooms','days','occupancy','rateCents','variableCents','fixedCents']);
  return {openingCashCents:integer(input.openingCashCents,'opening cash',0,10000000000),rooms:integer(input.rooms,'rooms',1,500),days:integer(input.days,'days',1,31),occupancy:integer(input.occupancy,'occupancy',0,100),rateCents:integer(input.rateCents,'room rate',0,100000000),variableCents:integer(input.variableCents,'variable cost',0,100000000),fixedCents:integer(input.fixedCents,'fixed costs',0,10000000000)};
}
export function taskInput(input) {
  fields(input, [
    ...organizationFields,
    "title",
    "notes",
    "goalId",
    "owner",
    "dueOn",
    "status",
    "priority",
  ]);
  return {
    ...organized(input),
    title: text(input.title, "title", 180),
    notes: text(input.notes ?? "", "notes", 8000, false),
    goalId: text(input.goalId ?? "", "goal", 80, false),
    owner: text(input.owner ?? "Owner", "owner", 120),
    dueOn: deadline(input.dueOn),
    status: choose(
      input.status ?? "todo",
      ["todo", "doing", "blocked", "done", "cancelled"],
      "task status",
    ),
    priority: choose(
      input.priority ?? "normal",
      ["high", "normal", "low"],
      "priority",
    ),
  };
}
export function recommendationInput(input, allowedRoles = roles) {
  fields(input, [
    "role",
    "kind",
    "targetId",
    "targetVersion",
    "rationale",
    "tradeoffs",
    "confidence",
    "evidence",
    "proposal",
  ]);
  const kind = choose(
    input.kind,
    ["goal", "task", "goal-review", "task-review", "idea", "idea-review", "idea-graduate"],
    "recommendation kind",
  );
  const isReview = kind.endsWith("-review") || kind === "idea-graduate";
  if (isReview)
    check(
      Number.isInteger(input.targetVersion) && input.targetVersion > 0,
      "Review must bind the current target version",
    );
  return {
    role: choose(input.role, allowedRoles, "executive role"),
    kind,
    targetId: text(input.targetId ?? "", "target", 80, isReview),
    targetVersion: isReview ? input.targetVersion : null,
    rationale: text(input.rationale, "rationale", 8000),
    tradeoffs: text(input.tradeoffs ?? "", "tradeoffs", 8000, false),
    confidence: choose(
      input.confidence ?? "medium",
      ["low", "medium", "high"],
      "confidence",
    ),
    evidence: text(input.evidence ?? "", "evidence", 12000, false),
    proposal: kind === "idea" || kind === "idea-review" ? ideaInput(input.proposal) : kind.startsWith("goal") || kind === "idea-graduate"
      ? goalInput(input.proposal)
      : taskInput(input.proposal),
  };
}
function initial(profile) {
  return {
    schema: 1,
    profile,
    revision: 0,
    goals: [],
    tasks: [],
    ideas: [],
    opportunities: [],
    ledger: [],
    settings: {defaultOwner:'Owner',purpose:''},
    preferenceHistory: [],
    recommendations: [],
    councilSessions: [],
    events: [],
    requests: [],
  };
}
export function validateState(s, profile) {
  check(
    s.schema === 1 &&
      s.profile === profile &&
      Number.isInteger(s.revision) &&
      s.revision >= 0,
    "State identity is invalid",
    503,
  );
  for (const key of ["goals", "tasks", "recommendations", "events", "requests"])
    check(Array.isArray(s[key]), "State is invalid", 503);
  check(s.councilSessions === undefined || Array.isArray(s.councilSessions), "Council sessions are invalid", 503);
  // Additive stores preserve older installations without seeding their records.
  for (const key of ['opportunities','ledger','preferenceHistory']) {
    s[key] ??= [];
    check(Array.isArray(s[key]), 'Business records are invalid', 503);
  }
  s.ideas ??= s.opportunities.map(legacyIdea);
  check(Array.isArray(s.ideas), "Ideas are invalid", 503);
  for (const row of s.opportunities) if (!s.ideas.some(i => i.id === row.id)) s.ideas.push(legacyIdea(row));
  s.settings ??= {defaultOwner:'Owner',purpose:''};
  return s;
}
export async function safeDirectory(directory) {
  // Reject symlinks at each level below the configured package root.
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  check(
    info.isDirectory() && !info.isSymbolicLink(),
    "State directory must not be a symlink",
    503,
  );
}
export async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, filename);
  const directory = await open(path.dirname(filename), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export class Store {
  constructor(root, allowedProfiles = null) {
    this.root = path.resolve(root);
    this.allowedProfiles = allowedProfiles;
  }
  async directory(profile) {
    check(typeof profile === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(profile) && (!this.allowedProfiles || this.allowedProfiles.includes(profile)), "Unknown installation", 404);
    await safeDirectory(this.root);
    await safeDirectory(path.join(this.root, profile));
    const directory = path.join(this.root, profile, "state");
    await safeDirectory(directory);
    return directory;
  }
  async read(profile) {
    const directory = await this.directory(profile);
    const filename = path.join(directory, "core.json");
    try {
      check(
        !(await lstat(filename)).isSymbolicLink(),
        "State file must not be a symlink",
        503,
      );
      return { ...validateState(
        JSON.parse(await readFile(filename, "utf8")),
        profile,
      ), council: await loadCouncil(path.join(this.root, profile), profile) };
    } catch (error) {
      if (error.code === "ENOENT") return { ...initial(profile), council: await loadCouncil(path.join(this.root, profile), profile) };
      if (error instanceof SyntaxError)
        throw new Fault(
          503,
          "State is unreadable. Restore a verified backup; do not reset it.",
        );
      throw error;
    }
  }
  async transact(profile, command, change) {
    const directory = await this.directory(profile);
    const lock = path.join(directory, ".writer");
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (e) {
      if (e.code === "EEXIST")
        throw new Fault(
          409,
          "Another writer is active. Retry after refreshing. A crashed writer requires explicit recovery.",
        );
      throw e;
    }
    try {
      const state = await this.read(profile);
      check(
        command &&
          typeof command.requestId === "string" &&
          /^[a-f0-9-]{36}$/.test(command.requestId),
        "A request identity is required",
      );
      const serialized = JSON.stringify(command);
      const prior = state.requests.find((r) => r.id === command.requestId);
      if (prior) {
        check(
          prior.command === serialized,
          "Request identity was reused with different contents",
          409,
        );
        return state;
      }
      check(
        command.expectedRevision === state.revision,
        "This view is out of date. Refresh before saving.",
        409,
      );
      const result = await change(state);
      state.revision++;
      state.events.push({
        id: randomUUID(),
        at: timestamp(),
        action: command.action,
        subjectId: result?.id ?? "",
        actor: result?.actor ?? "owner",
        revision: state.revision,
        detail: result?.detail ?? result?.title ?? "",
      });
      state.requests.push({ id: command.requestId, command: serialized });
      check(JSON.stringify(state.council) === JSON.stringify(await loadCouncil(path.join(this.root, profile), profile)), "Council configuration changed during publication. Refresh before saving.", 409);
      // Keep idempotence for the life of the store. Never silently evict identity history.
      await atomicJson(path.join(directory, "core.json"), state);
      return state;
    } finally {
      await rmdir(lock);
    }
  }
  async command(profile, command) {
    return this.transact(profile, command, (state) =>
      applyCommand(state, command),
    );
  }
}
function relations(state, data, kind, id = "") {
  for (const ideaId of data.ideaIds ?? []) check(state.ideas?.some(i => i.id === ideaId), "Linked idea does not belong to this installation");
  for (const linked of data.goalIds ?? []) check(state.goals.some(g => g.id === linked), "Linked goal does not belong to this installation");
  const goalId = kind === "goal" ? data.parentId : data.goalId;
  if (!goalId) return;
  check(
    state.goals.some((g) => g.id === goalId),
    "Linked goal does not belong to this installation",
  );
  if (kind === "goal") {
    const seen = new Set([id]);
    let current = goalId;
    while (current) {
      check(!seen.has(current), "Goal hierarchy would contain a cycle");
      seen.add(current);
      current = state.goals.find((g) => g.id === current)?.parentId;
    }
  }
}
function saveEntity(state, kind, data, id, origin = null) {
  const collection = state[{goal:'goals',task:'tasks',idea:'ideas',opportunity:'opportunities',entry:'ledger'}[kind]];
  const existing = id ? collection.find((g) => g.id === id) : null;
  if (id) check(existing, "Item not found in this installation", 404);
  relations(state, data, kind, id);
  const entry = {
    ...data,
    ...(kind === "idea" ? {original: existing?.original ?? (data.description || data.title), ...(existing?.legacy ? {legacy: existing.legacy} : {})} : {}),
    id: id || randomUUID(),
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? timestamp(),
    updatedAt: timestamp(),
    origin: existing?.origin ?? origin,
    history: [
      ...(existing?.history ?? []),
      ...(existing
        ? [
            {
              at: existing.updatedAt,
              version: existing.version,
              fields: Object.fromEntries(
                Object.entries(existing).filter(
                  ([k]) => !["history"].includes(k),
                ),
              ),
            },
          ]
        : []),
    ],
  };
  if (existing) collection[collection.indexOf(existing)] = entry;
  else collection.push(entry);
  return entry;
}
function saveIdea(state, data, id, origin = null) {
  const prior = id ? state.ideas.find(i => i.id === id) : null;
  check(data.status !== "graduated" || prior?.status === "graduated", "Use Graduate to goal to commit an idea");
  check(prior?.status !== "graduated" || data.status === "graduated", "Graduated ideas retain their goal and commitment history");
  check(data.status !== "graduated" || JSON.stringify(data.goalIds) === JSON.stringify(prior.goalIds), "Graduation links must be preserved");
  return saveEntity(state, "idea", data, id, origin);
}
export function applyCommand(state, command) {
  const { action, payload = {} } = command;
  state.ideas ??= (state.opportunities ?? []).map(legacyIdea);
  if (["idea.create", "idea.update"].includes(action)) {
    return saveIdea(state, ideaInput(payload.fields), action.endsWith("update") ? text(payload.id, "idea ID", 80) : "");
  }
  if (action === "idea.graduate") return graduateIdea(state, payload);
  if (['opportunity.create','opportunity.update','entry.create','entry.update'].includes(action)) {
    const kind=action.split('.')[0];
    const saved = saveEntity(state,kind,kind==='opportunity'?opportunityInput(payload.fields):entryInput(payload.fields),action.endsWith('update')?text(payload.id,'Record ID',80):'');
    if (kind === 'opportunity' && !state.ideas.some(i => i.id === saved.id)) state.ideas.push(legacyIdea(saved));
    return saved;
  }
  if (action === 'settings.update') {
    fields(payload,['defaultOwner','purpose']);
    const next={defaultOwner:text(payload.defaultOwner,'default owner',120),purpose:text(payload.purpose,'purpose',1000,false)};
    (state.preferenceHistory??=[]).push({kind:'settings',revision:state.revision+1,at:timestamp(),before:state.settings??null,after:next});
    state.settings=next;
    return {detail:'Updated workspace preferences'};
  }
  if (action === 'finance.plan.update') {
    const next=financePlanInput(payload);
    (state.preferenceHistory??=[]).push({kind:'financePlan',revision:state.revision+1,at:timestamp(),before:state.financePlan??null,after:next});
    state.financePlan=next;
    return {detail:'Updated finance assumptions'};
  }
  if (action === "goal.create" || action === "goal.update")
    return saveEntity(
      state,
      "goal",
      goalInput(payload.fields),
      action.endsWith("update") ? text(payload.id, "goal ID", 80) : "",
    );
  if (action === "task.create" || action === "task.update")
    return saveEntity(
      state,
      "task",
      taskInput(payload.fields),
      action.endsWith("update") ? text(payload.id, "task ID", 80) : "",
    );
  if (action === "recommendation.create") {
    const data = recommendationInput(payload, state.council?.identities.map(x => x.id) ?? roles);
    relations(
      state,
      data.proposal,
      data.kind === "idea-graduate" || data.kind.startsWith("goal") ? "goal" : data.kind.startsWith("idea") ? "idea" : "task",
      data.targetId,
    );
    if (data.kind.endsWith("-review") || data.kind === "idea-graduate") {
      const target = (
        data.kind.startsWith("idea") ? state.ideas : data.kind.startsWith("goal") ? state.goals : state.tasks
      ).find((i) => i.id === data.targetId);
      check(
        target && target.version === data.targetVersion,
        "Recommendation target is stale or outside this installation",
        409,
      );
    }
    const recommendation = {
      ...data,
      id: randomUUID(),
      status: "pending",
      createdAt: timestamp(),
    };
    state.recommendations.push(recommendation);
    return recommendation;
  }
  if (action === "recommendation.resolve") {
    const item = state.recommendations.find((r) => r.id === payload.id);
    check(item, "Recommendation not found", 404);
    check(
      ["pending", "deferred"].includes(item.status),
      "Recommendation already resolved",
      409,
    );
    choose(payload.decision, ["accepted", "rejected", "deferred"], "decision");
    if (payload.decision === "accepted") {
      if (item.kind === "idea-graduate") {
        const saved = graduateIdea(state, {id: item.targetId, targetVersion: item.targetVersion, fields: payload.fields ?? item.proposal}, item.id);
        item.resultId = saved.id;
      } else {
      const kind = item.kind.startsWith("idea") ? "idea" : item.kind.startsWith("goal") ? "goal" : "task";
      const collection = kind === "idea" ? state.ideas : kind === "goal" ? state.goals : state.tasks;
      if (item.kind.endsWith("-review"))
        check(
          collection.find((t) => t.id === item.targetId)?.version ===
            item.targetVersion,
          "Target changed since this recommendation. Request a fresh review.",
          409,
        );
      const data =
        kind === "idea" ? ideaInput(payload.fields ?? item.proposal) : kind === "goal"
          ? goalInput(payload.fields ?? item.proposal)
          : taskInput(payload.fields ?? item.proposal);
      const targetId = item.kind.endsWith("-review") ? item.targetId : "";
      const saved = kind === "idea" ? saveIdea(state, data, targetId, item.id) : saveEntity(state, kind, data, targetId, item.id);
      item.resultId = saved.id;
      }
    }
    item.status = payload.decision;
    item.resolvedAt = timestamp();
    item.ownerNote = text(payload.note ?? "", "note", 4000, false);
    return item;
  }
  throw new Fault(400, "Unknown command");
}

function graduateIdea(state, payload, origin = null) {
  const idea = state.ideas.find(i => i.id === payload.id);
  check(idea && idea.version === payload.targetVersion, "Idea changed or is outside this installation. Refresh before graduating.", 409);
  check(idea.status !== "graduated", "Idea has already graduated", 409);
  check(idea.status !== "archived", "Restore the archived idea before graduating", 409);
  let goal;
  if (payload.goalId) {
    goal = state.goals.find(g => g.id === payload.goalId);
    check(goal, "Linked goal does not belong to this installation");
    const {id, version, createdAt, updatedAt, history, origin: priorOrigin, ...data} = goal;
    goal = saveEntity(state, "goal", goalInput({...data, ideaIds: [...new Set([...(goal.ideaIds ?? []), idea.id])]}), goal.id);
  } else {
    const data = goalInput({...payload.fields, projects: payload.fields?.projects ?? idea.projects, tags: payload.fields?.tags ?? idea.tags,
      ideaIds: [...new Set([...(payload.fields?.ideaIds ?? []), idea.id])]});
    check(data.successCriteria.trim(), "Define success before graduating an idea");
    goal = saveEntity(state, "goal", data, "", origin);
  }
  const data = Object.fromEntries(ideaFields.map(key => [key, idea[key]]));
  saveEntity(state, "idea", ideaInput({...data, status: "graduated", goalIds: [...new Set([...idea.goalIds, goal.id])]}), idea.id, origin);
  return goal;
}
