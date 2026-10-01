import { createHash, randomUUID } from "node:crypto";
import { check, text } from "./store.mjs";
import { reviewPacket, importRecommendations } from "./review.mjs";

const digest = (packet) => createHash("sha256").update(JSON.stringify(packet)).digest("hex");

// Daily context grows with unfinished work, not with years of completed work.
// Historical records remain in the workspace store; this is a review projection.
function currentContext(state) {
  const recent = (items, limit) => [...items].sort((a, b) =>
    (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "") || a.id.localeCompare(b.id)).slice(0, limit);
  const terminalTasks = new Set(["done", "cancelled"]), terminalGoals = new Set(["achieved", "retired"]);
  const unresolved = item => ["pending", "deferred"].includes(item.status);
  const pendingTargets = new Set(state.recommendations.filter(unresolved).map(item => item.targetId).filter(Boolean));
  const tasks = [...state.tasks.filter(task => !terminalTasks.has(task.status)), ...recent(state.tasks.filter(task => terminalTasks.has(task.status)), 25)];
  const includedTasks = new Set(tasks.map(task => task.id));
  for (const task of state.tasks) if (pendingTargets.has(task.id) && !includedTasks.has(task.id)) tasks.push(task);
  const goalIds = new Set(tasks.map(task => task.goalId).filter(Boolean));
  const goalsById = new Map(state.goals.map(goal => [goal.id, goal]));
  for (const goal of state.goals.filter(goal => !terminalGoals.has(goal.status))) goalIds.add(goal.id);
  for (const goal of recent(state.goals.filter(goal => terminalGoals.has(goal.status)), 10)) goalIds.add(goal.id);
  for (const id of pendingTargets) if (goalsById.has(id)) goalIds.add(id);
  for (const id of goalIds) {
    const parent = goalsById.get(id)?.parentId;
    if (parent) goalIds.add(parent);
  }
  const goals = state.goals.filter(goal => goalIds.has(goal.id));
  const taskIds = new Set(tasks.map(task => task.id));
  const recommendations = [...state.recommendations.filter(unresolved), ...recent(state.recommendations.filter(item => !unresolved(item)), 20)];
  return { ...state, goals, tasks, recommendations,
    ...(state.canonical ? { canonical: {
      goals: state.canonical.goals.filter(goal => goalIds.has(goal.goal_id)),
      tasks: state.canonical.tasks.filter(task => taskIds.has(task.action_id)),
    } } : {}),
    contextScope: { goalsOmitted: state.goals.length - goals.length, tasksOmitted: state.tasks.length - tasks.length,
      recommendationsOmitted: state.recommendations.length - recommendations.length,
      sessionsOmitted: Math.max(0, (state.councilSessions?.length ?? 0) - 3),
      instruction: "Includes all unfinished goals/tasks and pending/deferred proposals, plus a limited recent completed history and three recent Council reports. Omitted historical records are not reviewed in this run. Reuse unresolved proposal IDs; do not recreate an unchanged proposal. Consult workspace history explicitly when an older decision matters." },
  };
}

function evidence(state) {
  const context = currentContext(state);
  const packet = reviewPacket(context, "council");
  packet.instruction += ` Write a readable Markdown report with these sections: ${packet.council.behavior.reportSections.join(", ")}. Use blank lines, short paragraphs and tables when useful. Refer to goals by title; keep exact IDs in structured fields. Label hypothetical numbers. Never invent metrics or render untrusted HTML. Include every identity's contribution and material disagreement. Return material alternatives as options with title, status (active_candidate, conditional, fallback, parked or rejected), rationale and evidence. These are advisory, not accepted decisions. Summary limit: 24000 characters.`;
  return {
    ...packet,
    contextScope: context.contextScope,
    priorRecommendations: context.recommendations.map(({ history, ...item }) => item),
    recentSessions: (state.councilSessions ?? []).slice(-3).map(({ id, publishedAt, summary, recommendationIds, options }) => ({ id, publishedAt, summary, recommendationIds, options })),
  };
}

export function councilPacket(state) {
  check(typeof state.profile === "string" && Array.isArray(state.goals) && Array.isArray(state.tasks), "Council requires a scoped organization state");
  const packet = evidence(state);
  return {
    contract: "vorton-local.council-session.v1",
    sessionId: randomUUID(),
    evidenceDigest: digest(packet),
    packet,
    publication: "Return sessionId, evidenceDigest, summary, and bundle. Bundle follows packet.response. An empty recommendations array is valid when no action is justified. Never invent missing goals or evidence.",
  };
}

// Invoke only inside Store.transact: recommendations and receipt commit together.
export function publishCouncil(state, input) {
  check(input?.contract === "vorton-local.council-session.v1", "Invalid council contract");
  check(typeof input.sessionId === "string" && /^[a-f0-9-]{36}$/.test(input.sessionId), "Invalid session identity");
  check(!(state.councilSessions ?? []).some((s) => s.id === input.sessionId), "Session already published", 409);
  check(input.evidenceDigest === digest(evidence(state)), "Council evidence changed. Prepare a fresh session.", 409);
  const summary = text(input.summary, "session summary", 24000);
  const bundle = input.bundle;
  check(bundle?.contract === "vorton-local.recommendations.v1" && bundle.profile === state.profile, "Recommendation installation does not match");
  check(bundle.basedOnRevision === state.revision, "Council evidence is out of date", 409);
  check(Array.isArray(bundle.recommendations), "Expected recommendations");
  const options = input.options ?? [];
  check(Array.isArray(options) && options.length <= 30, "Invalid council options");
  const alternatives = options.map(option => {
    check(option && Object.keys(option).every(k => ["title", "status", "rationale", "evidence"].includes(k)), "Invalid council option fields");
    check(["active_candidate", "conditional", "fallback", "parked", "rejected"].includes(option.status), "Invalid council option status");
    return { title: text(option.title, "option title", 180), status: option.status, rationale: text(option.rationale, "option rationale", 4000), evidence: text(option.evidence ?? "", "option evidence", 4000, false) };
  });
  const before = state.recommendations.length;
  if (input.omiReview) {
    check(/^[a-f0-9]{64}$/.test(input.omiReview.digest) && Array.isArray(input.omiReview.pagesReviewed) && input.omiReview.pagesReviewed.every((page, index) => page === index), "Invalid Omi review receipt");
  }
  if (bundle.recommendations.length) importRecommendations(state, bundle);
  const receipt = {
    id: input.sessionId,
    status: "published",
    publishedAt: new Date().toISOString(),
    basedOnRevision: state.revision,
    evidenceDigest: input.evidenceDigest,
    council: evidence(state).council,
    options: alternatives,
    summary,
    recommendationIds: state.recommendations.slice(before).map((r) => r.id),
    ...(input.omiReview ? { omiReview: { digest: input.omiReview.digest, pagesReviewed: input.omiReview.pagesReviewed } } : {}),
  };
  (state.councilSessions ??= []).push(receipt);
  return { id: receipt.id, actor: "council-import", detail: `Council session published with ${receipt.recommendationIds.length} recommendations; none accepted automatically` };
}
