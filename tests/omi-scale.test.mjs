import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { IntegrationVault } from "../server/integration-vault.mjs";
import { OmiIntegration } from "../server/omi-integration.mjs";

test("five years migrate in bounded batches; daily pages and status never rescan transcripts", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vorton-omi-scale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reads = [];
  const vault = new IntegrationVault(root, ["First", "Second"], { onRead: id => reads.push(id) });
  const omi = new OmiIntegration(root, ["First", "Second"], { vault, clock: () => Date.parse("2026-09-30T12:00:00Z") });
  const transcriptReads = () => reads.filter(id => id.startsWith("conversation:")).length;
  const key = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  await vault.run("First", "omi", tx => {
    tx.put("settings", { revision: 1, enabled: true, councilEnabled: true, historyCount: 7303 });
    tx.put("credential", { key: "omi_dev_SYNTHETIC_ONLY" });
    for (let n = 0; n < 7303; n++) {
      const daily = n >= 7300;
      const record = { id: `fixture-${n}`, created_at: daily ? "2026-09-27T19:00:00.000Z" : new Date(Date.UTC(2020, 0, 1 + Math.floor(n / 4), 19)).toISOString(),
        title: "PRIVATE_TITLE_CANARY", segments: [{ text: daily ? "PRIVATE_SPEECH_CANARY ".repeat(2000) : "PRIVATE_SPEECH_CANARY", start: 0, end: 1 }] };
      tx.put(`conversation:${key(record.id)}`, { record, contentHash: key(record), reviewedHash: !daily && n >= 20 ? key(record) : null, firstReceivedAt: "2026-09-30T12:00:00Z", version: 1 });
    }
  }, { create: true });
  let attempts = 0;
  while (true) {
    reads.length = 0;
    try { await omi.status("First"); break; }
    catch (error) { assert.match(error.message, /indexing is pending/); }
    assert.ok(transcriptReads() <= 250);
    assert.ok(++attempts < 40);
  }
  assert.equal(attempts, 29);
  reads.length = 0;
  const status = await omi.status("First");
  assert.equal(status.historyCount, 7303); assert.equal(status.pendingReviewCount, 23);
  assert.equal(transcriptReads(), 0);
  const history = await omi.history("First", { offset: 7000, limit: 25 });
  assert.equal(history.records.length, 25); assert.equal(transcriptReads(), 0);
  reads.length = 0;
  const manifest = await omi.councilMaterial("First", "2026-09-27");
  assert.equal(manifest.conversationCount, 11); assert.equal(manifest.deferredCount, 12);
  assert.equal(transcriptReads(), 11);
  assert.ok(manifest.pageCount > 3);
  reads.length = 0;
  let chunks = 0;
  for (let page = 0; page < manifest.pageCount; page++) chunks += (await omi.councilMaterial("First", manifest.day, page, manifest.digest)).evidence.length;
  assert.ok(chunks > 60); assert.equal(transcriptReads(), 0);
  assert.equal((await omi.councilMaterial("First", manifest.day)).digest, manifest.digest);
  assert.equal(transcriptReads(), 0);
  assert.equal(await omi.councilMaterial("Second", manifest.day), null);
  await omi.acknowledgeCouncil("First", { digest: manifest.digest, sessionId: "synthetic", publishedAt: "2026-09-30T12:00:00Z" });
  reads.length = 0;
  await omi.acknowledgeCouncil("First", { digest: manifest.digest, sessionId: "synthetic", publishedAt: "2026-09-30T12:00:00Z" });
  assert.equal(transcriptReads(), 0, "Receipt reconciliation must not repeatedly decrypt reviewed speech");
  assert.equal((await omi.status("First")).pendingReviewCount, 12);
  await assert.rejects(omi.councilMaterial("First", manifest.day, 0, manifest.digest), /changed/);
  assert.equal(transcriptReads(), 0);
  for (const file of await readdir(vault.directory)) {
    const bytes = await readFile(path.join(vault.directory, file));
    for (const privateValue of ["PRIVATE_TITLE_CANARY", "PRIVATE_SPEECH_CANARY", "2026-09-27T19:00:00.000Z"]) assert.equal(bytes.includes(Buffer.from(privateValue)), false);
  }
  // Simulate an older process that knows only the encrypted records table.
  reads.length = 0;
  await vault.run("First", "omi", tx => {
    const id = `conversation:${key("fixture-7300")}`, value = tx.get(id);
    value.record.segments[0].text = "PRIVATE_EDIT_CANARY";
    value.contentHash = key(value.record); value.version++;
    tx.put(id, value);
  });
  reads.length = 0;
  assert.equal((await omi.status("First")).pendingReviewCount, 13);
  assert.equal(transcriptReads(), 1, "Repair decrypts only the dirty record");
  reads.length = 0;
  await omi.status("First");
  assert.equal(transcriptReads(), 0);
});
