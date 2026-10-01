import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OmiIntegration } from "../server/omi-integration.mjs";
import { OmiFailure } from "../server/omi-client.mjs";
import { createCoreServer } from "../server/core-http.mjs";
import { omiWorkflow } from "../server/omi-workflow.mjs";

const secret = "omi_dev_SYNTHETIC_SECRET_ONLY";
const record = (id, text = "SYNTHETIC TRANSCRIPT CANARY") => ({ id, created_at: "2026-09-27T19:00:00Z", status: "completed", structured: { title: "Controlled example" }, transcript_segments: [{ start: 0, end: 10, text, speaker_name: "Synthetic speaker" }] });

test("dense daily scans resume beyond 20 pages and cannot admit a partial day", async t => {
  const { omi } = await fixture(t, async q => q.transcripts === false || q.offset >= 525 ? [] : Array.from({ length: 25 }, (_, n) => record(`dense-${q.offset + n}`)));
  const workflow = omiWorkflow("unused", ["First"], { services: { First: omi }, clock: omi.clock });
  const first = await workflow.refresh("First", "2026-09-27");
  assert.equal(first.status, "deferred"); assert.equal(first.code, "request_budget");
  assert.equal((await omi.councilMaterial("First", "2026-09-27")).dailyScanReady, false);
  const second = await workflow.refresh("First", "2026-09-27");
  assert.equal(second.status, "ready");
  const manifest = await omi.councilMaterial("First", "2026-09-27");
  assert.equal(manifest.dailyScanReady, true); assert.equal(manifest.coverage, "unverified");
  assert.equal(manifest.conversationCount, 525);
  const sources = new Set();
  for (let page = 0; page < manifest.pageCount; page++) for (const item of (await workflow.page("First", manifest.day, page, manifest.digest)).evidence) sources.add(item.source);
  assert.equal(sources.size, 525);
});

test("current Pacific days defer without pulling and malformed resumed days stay ineligible", async t => {
  let calls = 0;
  const malformed = record("bad"); malformed.transcript_segments.push({ text: "SYNTHETIC INVALID", start: -1, end: 2 });
  const { omi } = await fixture(t, async q => { if (q.transcripts === false) return []; calls++; return q.offset === 0 ? [malformed] : []; });
  const workflow = omiWorkflow("unused", ["First"], { services: { First: omi }, clock: omi.clock });
  assert.equal((await workflow.refresh("First", "2026-09-28")).code, "day_in_progress");
  assert.equal(calls, 0);
  await omi.sync("First", { day: "2026-09-27", mode: "replay", maxPages: 1 });
  const result = await workflow.refresh("First", "2026-09-27");
  assert.equal(result.code, "daily_records_excluded"); assert.equal(result.scanExcluded, 1);
  assert.equal((await omi.councilMaterial("First", "2026-09-27")).dailyScanReady, false);
});

test("rate-limited refresh never reuses a prior daily receipt as fresh ingestion", async t => {
  const { omi } = await fixture(t);
  const workflow = omiWorkflow("unused", ["First"], { services: { First: omi }, clock: omi.clock });
  assert.equal((await workflow.refresh("First", "2026-09-27")).status, "ready");
  omi.clientFactory = () => ({ list: async () => { throw new OmiFailure("http_429", 429, "2026-09-28T13:00:00Z"); } });
  assert.equal((await workflow.refresh("First", "2026-09-27")).status, "failed");
  assert.equal((await omi.councilMaterial("First", "2026-09-27")).dailyScanReady, false);
  assert.equal((await workflow.refresh("First", "2026-09-27")).code, "retry_pending");
});

test("an in-progress manual replay cannot become daily-ready just because midnight passes", async t => {
  const { omi } = await fixture(t);
  omi.clock = () => Date.parse("2026-09-27T20:00:00Z");
  await omi.sync("First", { day: "2026-09-27", mode: "replay" });
  assert.equal((await omi.councilMaterial("First", "2026-09-27")).dailyScanReady, false);
  omi.clock = () => Date.parse("2026-09-28T12:00:00Z");
  assert.equal((await omi.councilMaterial("First", "2026-09-27")).dailyScanReady, false);
  await omi.sync("First", { day: "2026-09-27", mode: "replay" });
  assert.equal((await omi.councilMaterial("First", "2026-09-27")).dailyScanReady, true);
});

test("oversized daily evidence fails explicitly instead of publishing a truncated day", async t => {
  const { omi } = await fixture(t, async q => q.transcripts === false || q.offset ? [] : Array.from({ length: 21 }, (_, n) => record(`large-${n}`, "x".repeat(100000))));
  await omi.sync("First", { day: "2026-09-27", mode: "replay" });
  assert.equal((await omi.status("First")).historyCount, 21);
  await assert.rejects(omi.councilMaterial("First", "2026-09-27"), /text budget.*deferred, not truncated/);
});

test("one Admin save commits key and preferences together and failed validation changes nothing", async t => {
  const { omi } = await fixture(t);
  let status = await omi.status("First");
  await omi.save("First", { expectedRevision: status.revision, key: secret, enabled: true, councilEnabled: false, folder: "synthetic-folder" });
  status = await omi.status("First");
  assert.equal(status.keyConfigured, true); assert.equal(status.enabled, true);
  assert.equal(status.councilEnabled, false); assert.equal(status.folder, "synthetic-folder");
  omi.clientFactory = () => ({ list: async () => { throw new OmiFailure("http_401"); } });
  await assert.rejects(omi.save("First", { expectedRevision: status.revision, key: secret, enabled: false, councilEnabled: true, folder: null }), /http_401/);
  assert.deepEqual(await omi.status("First"), status);
  await omi.save("First", { expectedRevision: status.revision, enabled: false, councilEnabled: true, folder: null });
  assert.equal((await omi.status("First")).enabled, false);
  await assert.rejects(omi.save("First", { expectedRevision: status.revision, enabled: true, councilEnabled: true }), /changed/);
});

test("Council refresh surfaces historical ingestion failures", async () => {
  const calls = [], failure = { status: "failed", code: "http_429" };
  const workflow = omiWorkflow("unused", ["First"], { services: { First: {
    status: async () => ({ enabled: true, keyConfigured: true }),
    sync: async (_profile, options) => { calls.push(options.mode); return options.mode === "backfill" ? failure : { status: "partial", code: "filtered_end_unverified" }; },
  } } });
  assert.equal(await workflow.refresh("First", "2026-09-27"), failure);
  assert.deepEqual(calls, ["replay", "recent", "backfill"]);
});
async function fixture(t, list = async () => []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vorton-omi-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const omi = new OmiIntegration(root, ["First", "Second"], { clientFactory: () => ({ list }), clock: () => Date.parse("2026-09-28T12:00:00Z") });
  await omi.saveKey("First", { key: secret, expectedRevision: 0 });
  await omi.configure("First", { expectedRevision: 1, enabled: true, councilEnabled: true });
  return { root, omi };
}

test("filtered short and empty pages do not truncate at the first gap; replay is idempotent", async t => {
  const offsets = [];
  const { omi } = await fixture(t, async q => {
    if (q.transcripts === false) return [];
    offsets.push(q.offset);
    return q.offset === 25 ? [record("one"), record("one")] : [];
  });
  const receipt = await omi.sync("First", { day: "2026-09-27" });
  assert.deepEqual(offsets, [0, 25, 50, 75]);
  assert.equal(receipt.historyCount, 1);
  assert.equal(receipt.coverage, "unverified");
  assert.equal(receipt.status, "partial");
  assert.ok(!JSON.stringify(receipt).includes("CANARY"));
  assert.equal((await omi.sync("First", { day: "2026-09-27" })).changed, 0);
  assert.equal((await omi.history("Second")).total, 0);
  assert.ok(!JSON.stringify(await omi.status("First")).includes(secret));
});

test("changed transcripts are retained as a new version without duplicate episodes", async t => {
  let text = "Before synthetic edit";
  const { omi } = await fixture(t, async q => q.transcripts === false || q.offset > 0 ? [] : [record("one", text)]);
  await omi.sync("First", { day: "2026-09-27" }); text = "After synthetic edit";
  await omi.sync("First", { day: "2026-09-27" });
  const history = await omi.history("First");
  assert.equal(history.total, 1); assert.equal(history.records[0].version, 2);
  assert.equal((await omi.transcript("First", history.records[0].id)).record.segments[0].text, text);
});

test("deleting history clears scan offsets and receipts before re-enabling", async t => {
  const offsets = [];
  const { omi } = await fixture(t, async q => {
    if (q.transcripts === false) return [];
    offsets.push(q.offset); return [record(`episode-${q.offset}`)];
  });
  await omi.sync("First", { day: "2026-09-27", mode: "replay", maxPages: 1 });
  await omi.configure("First", { expectedRevision: 2, enabled: false, councilEnabled: true });
  await omi.deleteHistory("First", { expectedRevision: 3, confirmation: "DELETE OMI HISTORY" });
  const status = await omi.status("First");
  assert.deepEqual(status.scans, {}); assert.deepEqual(status.dayReceipts, {});
  assert.equal((await omi.history("First")).total, 0);
  assert.equal((await omi.councilMaterial("First", "2026-09-27")).coverage, "not_synchronized");
  await omi.configure("First", { expectedRevision: 4, enabled: true, councilEnabled: true });
  await omi.sync("First", { day: "2026-09-27", mode: "replay", maxPages: 1 });
  assert.deepEqual(offsets, [0, 0]);
});

test("bounded day scans resume after restart and historical probes continue beyond empty gaps", async t => {
  const offsets = [];
  const { omi } = await fixture(t, async q => {
    if (q.transcripts === false) return [];
    offsets.push(q.offset);
    return [record(`episode-${q.offset}`)];
  });
  await omi.sync("First", { day: "2026-09-27", mode: "replay", maxPages: 1 });
  await omi.sync("First", { day: "2026-09-27", mode: "replay", maxPages: 1 });
  assert.deepEqual(offsets, [0, 25]);
  omi.clientFactory = () => ({ list: async q => { offsets.push(q.offset); return []; } });
  offsets.length = 0;
  await omi.sync("First", { day: "2026-09-27", mode: "backfill", maxPages: 2 });
  await omi.sync("First", { day: "2026-09-27", mode: "backfill", maxPages: 2 });
  assert.deepEqual(offsets, [0, 25, 50, 75]);
});

test("productive historical scans keep advancing across multiple weeks", async t => {
  const offsets = [];
  const { omi } = await fixture(t, async q => {
    if (q.transcripts === false) return [];
    offsets.push(q.offset); return [record(`historical-${q.offset}`)];
  });
  const start = Date.parse("2026-09-28T12:00:00Z");
  for (let day = 0; day < 21; day++) {
    omi.clock = () => start + day * 86400000;
    await omi.sync("First", { day: "2026-09-27", mode: "backfill", maxPages: 1 });
  }
  assert.deepEqual(offsets, Array.from({ length: 21 }, (_, index) => index * 25));
  const status = await omi.status("First");
  assert.equal(status.historyCount, 21);
  assert.equal(status.backfill.status, "pending");
  assert.equal(status.backfill.end, new Date(start).toISOString());
});

test("partial failure retains committed pages and defers retries without leaking upstream data", async t => {
  const { omi } = await fixture(t, async q => {
    if (q.transcripts === false) return [];
    if (q.offset === 0) return [record("one")];
    throw new OmiFailure("http_429", 429, "2026-09-28T13:00:00.000Z");
  });
  const result = await omi.sync("First", { day: "2026-09-27", mode: "backfill" });
  assert.equal(result.status, "failed"); assert.equal(result.historyCount, 1);
  assert.equal((await omi.status("First")).backfill.offset, 25);
  assert.deepEqual((await omi.councilMaterial("First", "2026-09-27")).warnings, [{ code: "http_429", retryAt: "2026-09-28T13:00:00.000Z" }]);
  await assert.rejects(omi.sync("First", { day: "2026-09-27" }), /deferred/);
});

test("key removal cancels an in-flight run and cannot resurrect removed access", async t => {
  let release, requested;
  const pending = new Promise(resolve => { requested = resolve; });
  const { omi } = await fixture(t, async q => {
    if (q.transcripts === false) return [];
    requested(); return new Promise(resolve => { release = resolve; });
  });
  const running = omi.sync("First", { day: "2026-09-27" });
  await pending;
  await omi.removeKey("First", { expectedRevision: 2 });
  release([record("one")]);
  await assert.rejects(running, /cancelled/);
  assert.equal((await omi.history("First")).total, 0);
  assert.equal((await omi.status("First")).keyConfigured, false);
});

test("admin API requires current session and same-origin writes, rejects unknown workspaces and never echoes keys", async t => {
  const { root, omi } = await fixture(t);
  const app = createCoreServer({ root, port: 0, enabledProfiles: ["First", "Second"], defaultPath: "/first/admin", omi });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`; app.hosts.add(new URL(base).host); app.allowed.add(base);
  const { token } = await (await fetch(base + "/api/session")).json();
  const endpoint = base + "/api/first/integrations/omi";
  assert.equal((await fetch(endpoint)).status, 403);
  const headers = { "X-Vorton-Session": token, "Content-Type": "application/json", Origin: base };
  const status = await (await fetch(endpoint, { headers })).text(); assert.ok(!status.includes(secret));
  assert.equal((await fetch(base + "/api/unknown/integrations/omi", { headers })).status, 404);
  assert.equal((await fetch(endpoint, { method: "POST", headers: { ...headers, Origin: "https://elsewhere.invalid" }, body: JSON.stringify({ action: "key.remove", expectedRevision: 2 }) })).status, 403);
  assert.equal((await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ action: "key.remove", expectedRevision: 2, unexpected: "private" }) })).status, 400);
});

test("Council manifest is transcript-free; bounded pages preserve all speech and reject stale evidence", async t => {
  let text = "Synthetic evidence 😀 ".repeat(3000);
  const { omi } = await fixture(t, async q => q.transcripts === false || q.offset > 0 ? [] : [record("one", text)]);
  await omi.sync("First", { day: "2026-09-27" });
  const manifest = await omi.councilMaterial("First", "2026-09-27");
  assert.equal(manifest.conversationCount, 1);
  assert.ok(manifest.pageCount > 1);
  assert.ok(!JSON.stringify(manifest).includes("Synthetic evidence"));
  let restored = "";
  for (let page = 0; page < manifest.pageCount; page++) {
    const result = await omi.councilMaterial("First", "2026-09-27", page, manifest.digest);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 26000);
    restored += result.evidence.map(item => item.text).join("");
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  assert.equal(restored, text);
  assert.equal(await omi.councilMaterial("Second", "2026-09-27"), null);
  text = "Edited synthetic evidence";
  await omi.sync("First", { day: "2026-09-27" });
  await assert.rejects(omi.councilMaterial("First", "2026-09-27", 0, manifest.digest), /changed/);
  await omi.configure("First", { expectedRevision: 2, enabled: true, councilEnabled: false });
  assert.equal(await omi.councilMaterial("First", "2026-09-27"), null);
});

test("unreviewed historical versions survive day changes and only committed exact versions are acknowledged", async t => {
  let text = "Original historical evidence";
  const { omi } = await fixture(t, async q => q.transcripts === false || q.offset > 0 ? [] : [record("old", text)]);
  await omi.sync("First", { day: "2026-09-27" });
  const snapshot = await omi.councilMaterial("First", "2026-10-10");
  assert.equal(snapshot.conversationCount, 1);
  text = "Edited after model review";
  await omi.sync("First", { day: "2026-09-27" });
  await omi.acknowledgeCouncil("First", { digest: snapshot.digest, sessionId: "synthetic-session", publishedAt: "2026-10-11T12:00:00Z" });
  assert.equal((await omi.status("First")).pendingReviewCount, 1);
  const fresh = await omi.councilMaterial("First", "2026-10-11");
  await omi.acknowledgeCouncil("First", { digest: fresh.digest, sessionId: "synthetic-next-session", publishedAt: "2026-10-12T12:00:00Z" });
  assert.equal((await omi.status("First")).pendingReviewCount, 0);
  assert.equal((await omi.councilMaterial("First", "2026-10-12")).conversationCount, 0);
});

test("historical batches never evict unreviewed records and selected-day evidence is not capped", async t => {
  const { omi } = await fixture(t, async q => q.transcripts === false || q.offset > 0 ? [] : Array.from({ length: 20 }, (_, n) => record(`batch-${n}`)));
  await omi.sync("First", { day: "2026-09-27" });
  assert.equal((await omi.councilMaterial("First", "2026-09-27")).conversationCount, 20);
  const first = await omi.councilMaterial("First", "2026-10-10");
  assert.equal(first.conversationCount, 8); assert.equal(first.deferredCount, 12);
  await omi.acknowledgeCouncil("First", { digest: first.digest, sessionId: "batch-session", publishedAt: "2026-10-11T12:00:00Z" });
  const next = await omi.councilMaterial("First", "2026-10-11");
  assert.equal(next.conversationCount, 8); assert.equal(next.deferredCount, 4);
  assert.equal((await omi.status("First")).pendingReviewCount, 12);
});
