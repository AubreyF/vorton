import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { councilPacket, publishCouncil } from "../server/council.mjs";

async function fixture() {
  const store = new Store(await mkdtemp(path.join(os.tmpdir(), "vorton-council-")));
  const packet = councilPacket(await store.read("FreedOS"));
  const input = {
    contract: packet.contract, sessionId: packet.sessionId,
    evidenceDigest: packet.evidenceDigest, summary: "Controlled review",
    bundle: { contract: "vorton-local.recommendations.v1", profile: "FreedOS", basedOnRevision: 0, recommendations: [] },
  };
  const publish = () => store.transact("FreedOS", {
    action: "council.publish", requestId: input.sessionId,
    expectedRevision: input.bundle.basedOnRevision, payload: input,
  }, (state) => publishCouncil(state, input));
  return { store, input, publish };
}

test("council publishes durable receipts and exact retries are idempotent", async () => {
  const { store, publish } = await fixture();
  await publish();
  const state = await publish();
  assert.equal(state.revision, 1);
  assert.equal(state.councilSessions.length, 1);
  assert.equal((await store.read("FreedOS")).councilSessions[0].summary, "Controlled review");
  assert.equal((await store.read("AubOS")).councilSessions.length, 0);
});

test("failed recommendation validation rolls back both recommendations and receipt", async () => {
  const { store, input, publish } = await fixture();
  input.bundle.recommendations = [
    { role: "COO", kind: "task", rationale: "Controlled evidence", proposal: { title: "Controlled task" } },
    { role: "invalid" },
  ];
  await assert.rejects(publish());
  const state = await store.read("FreedOS");
  assert.equal(state.revision, 0);
  assert.equal(state.recommendations.length, 0);
  assert.equal(state.councilSessions.length, 0);
});

test("changed evidence and cross-installation bundles cannot publish", async () => {
  const { input, publish } = await fixture();
  input.evidenceDigest = "changed";
  await assert.rejects(publish(), /evidence changed/);
  const other = await fixture();
  other.input.bundle.profile = "AubOS";
  await assert.rejects(other.publish(), /installation/);
  assert.throws(() => councilPacket({ profile: "AubOS" }), /scoped/);
});

test("published proposals remain advisory and the next packet includes their receipts", async () => {
  const { input, publish } = await fixture();
  input.bundle.recommendations = [{
    role: "COO", kind: "task", rationale: "Controlled evidence",
    proposal: { title: "Controlled task" },
  }];
  const state = await publish();
  assert.equal(state.tasks.length, 0);
  assert.equal(state.goals.length, 0);
  assert.deepEqual(state.councilSessions[0].recommendationIds, [state.recommendations[0].id]);
  const next = councilPacket(state);
  assert.equal(next.packet.priorRecommendations.length, 1);
  assert.equal(next.packet.recentSessions.length, 1);
  assert.notEqual(next.evidenceDigest, input.evidenceDigest);
});

test("five years of completed planning history do not accumulate in daily model context", () => {
  const make = (count) => ({ profile: "FreedOS", revision: 1,
    goals: [{ id: "current", status: "active", parentId: "retired-parent" }, { id: "retired-parent", status: "retired" }],
    tasks: [{ id: "active", status: "doing", goalId: "current" }, ...Array.from({ length: count }, (_, n) => ({ id: `task-${String(n).padStart(6, "0")}`, status: "done", notes: "x".repeat(1000), updatedAt: new Date(Date.UTC(2020, 0, n + 1)).toISOString() }))],
    recommendations: [{ id: "pending", status: "pending" }, { id: "deferred", status: "deferred" }, ...Array.from({ length: count }, (_, n) => ({ id: `proposal-${n}`, status: "rejected", rationale: "x".repeat(1000) }))],
    councilSessions: Array.from({ length: count }, (_, n) => ({ id: `session-${n}`, summary: "x".repeat(24000), recommendationIds: [], council: { privateHistoricalRoster: true } })),
  });
  const short = councilPacket(make(30)).packet, years = councilPacket(make(1826)).packet;
  assert.equal(years.tasks.length, 26);
  assert.equal(years.goals.length, 2, "A current task's goal ancestry remains available");
  assert.equal(years.priorRecommendations.length, 22);
  assert.equal(years.recentSessions.length, 3);
  assert.ok(!Object.hasOwn(years.recentSessions[0], "council"));
  assert.equal(years.contextScope.tasksOmitted, 1801);
  assert.equal(years.contextScope.sessionsOmitted, 1823);
  assert.ok(Buffer.byteLength(JSON.stringify(years)) < Buffer.byteLength(JSON.stringify(short)) + 1000);
});

test("unresolved review proposals retain old target records outside the recent history window", () => {
  const state = { profile: "FreedOS", revision: 1,
    goals: Array.from({ length: 20 }, (_, n) => ({ id: `g${n}`, status: "retired", updatedAt: String(n).padStart(3, "0") })),
    tasks: Array.from({ length: 40 }, (_, n) => ({ id: `t${n}`, goalId: "g0", status: "done", updatedAt: String(n).padStart(3, "0") })),
    recommendations: [{ id: "review-goal", targetId: "g1", status: "pending", kind: "goal-review" }, { id: "review-task", targetId: "t0", status: "deferred", kind: "task-review" }],
  };
  const packet = councilPacket(state).packet;
  assert.ok(packet.goals.some(goal => goal.id === "g1"));
  assert.ok(packet.goals.some(goal => goal.id === "g0"));
  assert.ok(packet.tasks.some(task => task.id === "t0"));
});
