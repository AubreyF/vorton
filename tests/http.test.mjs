import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createCoreServer } from "../server/core-http.mjs";
import { roles } from "../server/store.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-http-"));
  const app = createCoreServer({ root, port: 0, enabledProfiles: ["LastResort", "Other"] });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  app.hosts.add(new URL(base).host);
  app.allowed.add(base);
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const session = await (await fetch(`${base}/api/session`)).json();
  const headers = { Origin: base, "Content-Type": "application/json", "X-Vorton-Session": session.token };
  const read = async (profile = "lastresort", endpoint = "state") => (await fetch(`${base}/api/${profile}/${endpoint}`)).json();
  const command = async (action, payload, profile = "lastresort") => {
    const state = await read(profile);
    const response = await fetch(`${base}/api/${profile}/command`, {
      method: "POST", headers,
      body: JSON.stringify({ action, payload, requestId: randomUUID(), expectedRevision: state.revision }),
    });
    return { status: response.status, state: await response.json() };
  };
  return { base, read, command };
}

test("Forge HTTP aliases retain workspace scope and query strings", async t => {
  const { base } = await fixture(t);
  for (const [from, to] of [
    ["/local/LastResort/goals?project=Opening", "/lastresort/forge/goals?project=Opening"],
    ["/OTHER/tasks", "/other/forge/tasks"],
    ["/lastresort/opportunities", "/lastresort/forge/ideas"],
    ["/lastresort/ideas/", "/lastresort/forge/ideas"],
    ["/lastresort/guestbook", "/lastresort/admin/organization"],
  ]) {
    const response = await fetch(base + from, { redirect: "manual" });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), to);
  }
  assert.equal((await fetch(`${base}/unknown/tasks`, { redirect: "manual" })).status, 404);
  assert.equal((await fetch(`${base}/api/unknown/state`)).status, 404);
});

test("Council ideas remain advisory through HTTP until accepted and export their graduation history", async t => {
  const { read, command } = await fixture(t);
  const proposed = await command("recommendation.create", {
    role: roles[0], kind: "idea", rationale: "A fictional trial", proposal: { title: "Try a pillow sample", tags: ["trial"] },
  });
  assert.equal(proposed.status, 200);
  assert.equal(proposed.state.ideas.length, 0);
  const id = proposed.state.recommendations[0].id;
  await command("recommendation.resolve", { id, decision: "deferred" });
  assert.equal((await read()).ideas.length, 0);
  const admitted = await command("recommendation.resolve", { id, decision: "accepted" });
  assert.equal(admitted.status, 200);
  const idea = admitted.state.ideas[0];
  assert.equal(admitted.state.ideas.length, 1);
  assert.equal((await command("idea.graduate", {
    id: idea.id, targetVersion: idea.version, fields: { title: "Pillow trial", successCriteria: "Sample survives a wash" },
  }, "other")).status, 409);
  assert.equal((await read("other")).goals.length, 0);
  assert.equal((await command("idea.graduate", {
    id: idea.id, targetVersion: idea.version, fields: { title: "Pillow trial", successCriteria: "Sample survives a wash" },
  })).status, 200);
  const exported = await read("lastresort", "export");
  assert.equal(exported.ideas[0].status, "graduated");
  assert.equal(exported.ideas[0].history.length, 1);
  assert.deepEqual(exported.goals[0].ideaIds, [idea.id]);
  assert.deepEqual(exported.ideas[0].goalIds, [exported.goals[0].id]);
  assert.equal(exported.recommendations[0].resultId, idea.id);
});
