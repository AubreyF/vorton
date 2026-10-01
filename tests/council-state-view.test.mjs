import test from "node:test";
import assert from "node:assert/strict";
import { councilStateView } from "../server/council-state-view.mjs";

test("five years of reports produce a lightweight timeline with explicit on-demand bodies", () => {
  const sessions = Array.from({ length: 1826 }, (_, index) => ({ id: `s${index}`, summary: "x".repeat(24000), council: { identities: [] }, options: [], publishedAt: new Date(Date.UTC(2020, 0, index + 1)).toISOString() }));
  const state = { profile: "Fixture", councilSessions: sessions };
  const view = councilStateView(state);
  assert.equal(view.councilSessions.length, 1826);
  assert.equal(view.councilSessions.filter(session => !session.summaryDeferred).length, 14);
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 600000);
  assert.equal(view.councilSessions[0].summary, "");
  const hydrated = councilStateView(state, { sessionId: "s0" });
  assert.deepEqual(hydrated.councilSessions[0], sessions[0]);
  assert.equal(hydrated.councilSessions[1].summaryDeferred, true);
  assert.equal(councilStateView(state, { fullHistory: true }), state);
  assert.equal(state.councilSessions[0].summary.length, 24000);
  assert.throws(() => councilStateView(state, { sessionId: "foreign" }), /not found in this workspace/);
});
