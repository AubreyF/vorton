import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, utimes, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.mjs";
import { councilPacket } from "../server/council.mjs";
// Synthetic workspace names keep this suite independent of an installation registry.
const profiles = ["FreedOS", "AubOS", "LastResort"];
import { nightlySessionId, latestCouncilNight, loadCouncilState, nightlyCouncilStatus, prepareNightlyCouncil, publishNightlyCouncil, planNightlyCouncils, prepareNightlyAttempt, publishNightlyAttempt, recordNightlyFailure } from "../server/council-nightly.mjs";

const config = { profiles };
const nightly = { firstNight: "2026-09-17", timezone: "America/Los_Angeles", hour: 21, maxAttempts: 3, cooldownMs: 3600000, batchSize: 3 };
const policyConfig = { profiles, nightly };
const due = new Date("2026-09-18T04:00:00Z");
const night = "2026-09-17";
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vorton-council-nightly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const response = (packet) => ({ contract: packet.contract, sessionId: packet.sessionId, evidenceDigest: packet.evidenceDigest, summary: "Controlled nightly council.", bundle: { contract: "vorton-local.recommendations.v1", profile: packet.packet.profile, basedOnRevision: packet.packet.revision, recommendations: [{ role: "CEO", kind: "task", rationale: "Controlled evidence.", proposal: { title: "Controlled next action" } }] } });

test("failed or unfinished daily ingestion spends no Council attempt; concurrent callers reserve once", async t => {
  const root = await fixture(t);
  let ready = false;
  const configuration = { ...policyConfig, omi: {
    refresh: async () => ({ status: ready ? "disabled" : "deferred", code: "request_budget" }),
    manifest: async () => null,
  } };
  for (let n = 0; n < 4; n++) assert.equal((await prepareNightlyAttempt(root, profiles[0], night, configuration, due)).status, "deferred");
  ready = true;
  const results = await Promise.all([prepareNightlyAttempt(root, profiles[0], night, configuration, due), prepareNightlyAttempt(root, profiles[0], night, configuration, due)]);
  assert.equal(results.filter(x => x.nightly?.attempt === 1).length, 1);
  assert.equal(results.filter(x => x.status === "cooldown").length, 1);
});

test("a failed daily scan after preparation blocks publication even with every page acknowledged", async t => {
  const root = await fixture(t); let dailyScanReady = true;
  const digest = "c".repeat(64);
  const configuration = { ...config, omi: {
    refresh: async () => ({ status: "ready" }),
    manifest: async () => ({ digest, dailyScanReady, pageCount: 0, conversationCount: 0, day: "2026-09-16", coverage: "unverified" }),
  } };
  const packet = await prepareNightlyCouncil(root, profiles[0], night, configuration);
  const input = { ...response(packet), omiReview: { digest, pagesReviewed: [] } };
  dailyScanReady = false;
  await assert.rejects(publishNightlyCouncil(root, profiles[0], night, input, configuration), /scan is unfinished/);
  assert.equal((await nightlyCouncilStatus(root, profiles[0], night, configuration)).status, "missing");
});

test("Omi Council publication requires every evidence page and the current digest", async t => {
  const root = await fixture(t);
  let digest = "a".repeat(64);
  const acknowledgements = [];
  const configured = { ...config, omi: {
    refresh: async (profile, day) => { assert.equal(day, "2026-09-16"); return { status: "ready" }; },
    manifest: async () => ({ digest, dailyScanReady: true, pageCount: 2, conversationCount: 3, coverage: "unverified", day: "2026-09-16" }),
    acknowledge: async (profile, receipt) => acknowledgements.push({ profile, ...receipt }),
  } };
  const packet = await prepareNightlyCouncil(root, profiles[0], night, configured);
  const input = response(packet);
  await assert.rejects(publishNightlyCouncil(root, profiles[0], night, input, configured));
  input.omiReview = { digest, pagesReviewed: [0] };
  await assert.rejects(publishNightlyCouncil(root, profiles[0], night, input, configured));
  input.omiReview.pagesReviewed = [0, 1];
  digest = "b".repeat(64);
  await assert.rejects(publishNightlyCouncil(root, profiles[0], night, input, configured));
  input.omiReview.digest = digest;
  assert.equal(acknowledgements.length, 0, "Failed coverage checks cannot acknowledge evidence");
  assert.equal((await publishNightlyCouncil(root, profiles[0], night, input, configured)).status, "published");
  assert.equal(acknowledgements.length, 1);
  assert.equal(acknowledgements[0].digest, digest);
  const receipt = await nightlyCouncilStatus(root, profiles[0], night, configured);
  assert.deepEqual(receipt.omiReview, { digest, pagesReviewed: [0, 1] });
  assert.equal(acknowledgements.length, 2, "Status reconciles acknowledgement after an interrupted publication response");
});

test("nightly publication IDs are deterministic and isolate profile and calendar day", () => {
  const ids = profiles.flatMap((profile) => [night, "2026-09-18"].map((date) => nightlySessionId(profile, date)));
  assert.equal(new Set(ids).size, profiles.length * 2);
  assert.equal(nightlySessionId("AubOS", night), nightlySessionId("AubOS", night));
  assert.match(ids[0], /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  for (const invalid of ["2026-02-29", "2026-13-01", "2026-1-01", "../2026-01-01", ""]) assert.throws(() => nightlySessionId("AubOS", invalid), /Invalid council night/);
  assert.throws(() => nightlySessionId("../Foreign", night), /Invalid council profile/);
});

test("latest due night uses the local start boundary, midnight, and DST calendar dates", () => {
  const cases = [
    ["2026-09-18T03:59:59Z", "2026-09-16"],
    ["2026-09-18T04:00:00Z", "2026-09-17"],
    ["2026-09-18T07:00:00Z", "2026-09-17"],
    ["2026-09-19T03:59:59Z", "2026-09-17"],
    ["2026-09-19T04:00:00Z", "2026-09-18"],
    ["2026-03-08T09:30:00Z", "2026-03-07"],
    ["2026-03-08T10:30:00Z", "2026-03-07"],
    ["2026-03-09T03:59:59Z", "2026-03-07"],
    ["2026-03-09T04:00:00Z", "2026-03-08"],
    ["2026-11-01T08:30:00Z", "2026-10-31"],
    ["2026-11-01T09:30:00Z", "2026-10-31"],
    ["2026-11-02T04:59:59Z", "2026-10-31"],
    ["2026-11-02T05:00:00Z", "2026-11-01"],
    ["2027-01-01T08:00:00Z", "2026-12-31"],
  ];
  for (const [now, expected] of cases) assert.equal(latestCouncilNight(now, "America/Los_Angeles"), expected, now);
  assert.equal(latestCouncilNight("2026-09-18T00:00:00Z", "UTC", 0), "2026-09-18");
  assert.equal(latestCouncilNight("2026-09-18T03:00:00Z", "Asia/Tokyo", 12), "2026-09-18");
  assert.throws(() => latestCouncilNight("invalid", "UTC"), /Invalid council clock/);
  assert.throws(() => latestCouncilNight(new Date(), "UTC", 24), /Invalid council start hour/);
  assert.throws(() => latestCouncilNight(new Date(), "Invalid/Timezone"), /time zone/i);
});

test("all registry profiles publish once per night through the existing store", async (t) => {
  const root = await fixture(t);
  for (const profile of profiles) {
    const original = await loadCouncilState(root, profile, config);
    const prepared = await prepareNightlyCouncil(root, profile, night, config);
    assert.equal(prepared.packet.profile, profile);
    assert.equal(prepared.sessionId, nightlySessionId(profile, night));
    assert.equal(prepared.evidenceDigest, councilPacket(original).evidenceDigest);
    assert.equal((await nightlyCouncilStatus(root, profile, night, config)).status, "missing");
    const input = response(prepared);
    const first = await publishNightlyCouncil(root, profile, night, input, config);
    assert.equal(first.status, "published");
    assert.equal(first.alreadyPublished, false);
    assert.equal(first.accepted, 0);
    const again = await publishNightlyCouncil(root, profile, night, input, config);
    assert.equal(again.alreadyPublished, true);
    assert.equal(again.revision, first.revision);
    assert.equal((await prepareNightlyCouncil(root, profile, night, config)).alreadyPublished, true);
    const stored = await new Store(root).read(profile);
    assert.equal(stored.councilSessions.length, 1);
    assert.equal(stored.recommendations.length, 1);
    assert.equal(stored.tasks.length, 0);
    assert.equal(stored.requests[0].id, prepared.sessionId);
    assert.equal((await nightlyCouncilStatus(root, profile, "2026-09-18", config)).status, "missing");
  }
});

test("wrong profile, night, and stale evidence cannot publish a nightly receipt", async (t) => {
  const root = await fixture(t);
  const packet = await prepareNightlyCouncil(root, "FreedOS", night, config);
  const input = response(packet);
  await assert.rejects(publishNightlyCouncil(root, "FreedOS", "2026-09-18", input, config), /does not match/);
  await assert.rejects(publishNightlyCouncil(root, "AubOS", night, input, config), /does not match/);
  await assert.rejects(publishNightlyCouncil(root, "FreedOS", night, { ...input, bundle: { ...input.bundle, profile: "AubOS" } }, config), /profile mismatch/);
  await assert.rejects(publishNightlyCouncil(root, "FreedOS", night, { ...input, evidenceDigest: "changed" }, config), /evidence changed/);
  await new Store(root).command("FreedOS", { action: "task.create", requestId: randomUUID(), expectedRevision: 0, payload: { fields: { title: "New controlled evidence" } } });
  await assert.rejects(publishNightlyCouncil(root, "FreedOS", night, input, config), /out of date/);
  assert.equal((await nightlyCouncilStatus(root, "FreedOS", night, config)).status, "missing");
  const refreshed = await prepareNightlyCouncil(root, "FreedOS", night, config);
  assert.equal(refreshed.sessionId, packet.sessionId);
  assert.notEqual(refreshed.evidenceDigest, packet.evidenceDigest);
  assert.equal((await publishNightlyCouncil(root, "FreedOS", night, response(refreshed), config)).status, "published");
});

test("an injected workspace adapter is isolated and never silently replaced by core state", async (t) => {
  const root = await fixture(t);
  const calls = [];
  const adapter = { async read() {
    calls.push("read");
    return { profile: "AubOS", marker: "authoritative fixture" };
  } };
  const authoritative = { profiles, adapters: { AubOS: adapter } };
  assert.equal((await loadCouncilState(root, "AubOS", authoritative)).marker, "authoritative fixture");
  assert.deepEqual(calls, ["read"]);
  assert.equal((await loadCouncilState(root, "FreedOS", authoritative)).profile, "FreedOS");
  assert.equal(calls.length, 1);
  await assert.rejects(loadCouncilState(root, "AubOS", {}), /configuration is required/);
  await assert.rejects(loadCouncilState(root, "Foreign", config), /Unknown council profile/);
});

test("a committed receipt survives an interrupted publication response without duplicate recommendations", async (t) => {
  const root = await fixture(t);
  const packet = await prepareNightlyCouncil(root, "FreedOS", night, config);
  const original = Store.prototype.transact;
  t.mock.method(Store.prototype, "transact", async function (...args) {
    await original.apply(this, args);
    throw new Error("Controlled response interruption after commit");
  });
  const result = await publishNightlyCouncil(root, "FreedOS", night, response(packet), config);
  assert.equal(result.status, "published");
  assert.equal(result.alreadyPublished, true);
  const persisted = await loadCouncilState(root, "FreedOS", config);
  assert.equal(persisted.councilSessions.length, 1);
  assert.equal(persisted.recommendations.length, 1);
  assert.equal(persisted.revision, 1);
  const retry = await publishNightlyCouncil(root, "FreedOS", night, response(packet), config);
  assert.equal(retry.revision, 1);
});

test("heartbeat planning respects activation, enumerates configured workspaces, and bounds ready work", async (t) => {
  const root = await fixture(t);
  const before = await planNightlyCouncils(root, policyConfig, new Date(due.getTime() - 1));
  assert.equal(before.ready.length, 0);
  assert.ok(before.profiles.every((row) => row.status === "not-due"));
  const expanded = { ...policyConfig, profiles: [...profiles, "NewFixture"] };
  const plan = await planNightlyCouncils(root, expanded, due);
  assert.equal(plan.profiles.length, profiles.length + 1);
  assert.equal(plan.ready.length, 3);
  assert.ok(plan.profiles.some((row) => row.profile === "NewFixture" && row.status === "ready"));
  const packet = await prepareNightlyAttempt(root, profiles[0], night, expanded, due);
  await publishNightlyCouncil(root, profiles[0], night, response(packet), expanded);
  const next = await planNightlyCouncils(root, expanded, due);
  assert.equal(next.profiles[0].status, "published");
  assert.ok(next.ready.some((row) => row.profile === "NewFixture"));
});

test("durable attempts enforce one hour cooldown and three attempts without losing successful receipts", async (t) => {
  const root = await fixture(t), profile = "FreedOS";
  const first = await prepareNightlyAttempt(root, profile, night, policyConfig, due);
  assert.equal(first.nightly.attempt, 1);
  assert.equal(first.nightly.preparedAt, due.toISOString());
  const immediate = await prepareNightlyAttempt(root, profile, night, policyConfig, due);
  assert.equal(immediate.status, "cooldown");
  assert.equal(immediate.packet, undefined);
  await recordNightlyFailure(root, profile, night, policyConfig, first.nightly.attempt, "Controlled interrupted review", due);
  const persisted = JSON.parse(await readFile(path.join(root, ".runtime", "council-nightly", "attempts", profile, night, "1", "attempt.json"), "utf8"));
  assert.equal(persisted.status, "failed");
  const restartedPlan = await planNightlyCouncils(root, { ...policyConfig }, due);
  assert.equal(restartedPlan.profiles.find((row) => row.profile === profile).status, "cooldown");
  const second = await prepareNightlyAttempt(root, profile, night, policyConfig, new Date(due.getTime() + 3600000));
  assert.equal(second.nightly.attempt, 2);
  const third = await prepareNightlyAttempt(root, profile, night, policyConfig, new Date(due.getTime() + 7200000));
  assert.equal(third.nightly.attempt, 3);
  const exhausted = await prepareNightlyAttempt(root, profile, night, policyConfig, new Date(due.getTime() + 10800000));
  assert.equal(exhausted.status, "exhausted");
  assert.equal(exhausted.attempts, 3);
  await publishNightlyAttempt(root, profile, night, response(third), policyConfig, third.nightly.attempt);
  const completed = await planNightlyCouncils(root, policyConfig, new Date(due.getTime() + 10800000));
  assert.equal(completed.profiles.find((row) => row.profile === profile).status, "published");
  assert.equal((await prepareNightlyAttempt(root, profile, night, policyConfig, due)).alreadyPublished, true);
  const receipt = (await loadCouncilState(root, profile, config)).councilSessions[0];
  assert.match(receipt.summary, /Council night: 2026-09-17 · Reviewed 2026-09-17 23:00 \(America\/Los_Angeles\)/);
  assert.doesNotMatch(receipt.summary, /Catch-up review/);
});

test("a crash after atomic reservation preserves its attempt and allows later retry", async (t) => {
  const root = await fixture(t), profile = "FreedOS";
  const reservation = path.join(root, ".runtime", "council-nightly", "attempts", profile, night, "1");
  await mkdir(reservation, { recursive: true });
  await utimes(reservation, due, due);
  const plan = await planNightlyCouncils(root, policyConfig, due);
  const row = plan.profiles.find((item) => item.profile === profile);
  assert.equal(row.status, "cooldown");
  assert.equal(row.lastAttempt.status, "interrupted");
  const retry = await prepareNightlyAttempt(root, profile, night, policyConfig, new Date(due.getTime() + 3600000));
  assert.equal(retry.nightly.attempt, 2);
});

test("recurring publication requires its active reserved evidence and stale failures cannot alter later attempts", async (t) => {
  const root = await fixture(t), profile = "FreedOS";
  const unreserved = await prepareNightlyCouncil(root, profile, night, policyConfig);
  await assert.rejects(publishNightlyAttempt(root, profile, night, response(unreserved), policyConfig, 1), /No nightly attempt/);
  const first = await prepareNightlyAttempt(root, profile, night, policyConfig, due);
  await assert.rejects(publishNightlyAttempt(root, profile, night, response(first), policyConfig, undefined), /positive nightly attempt/);
  await recordNightlyFailure(root, profile, night, policyConfig, 1, "Controlled first failure", due);
  await assert.rejects(publishNightlyAttempt(root, profile, night, response(first), policyConfig, 1), /no active prepared packet/);
  await new Store(root).command(profile, { action: "task.create", requestId: randomUUID(), expectedRevision: 0, payload: { fields: { title: "Changed controlled evidence" } } });
  const second = await prepareNightlyAttempt(root, profile, night, policyConfig, new Date(due.getTime() + 3600000));
  await assert.rejects(recordNightlyFailure(root, profile, night, policyConfig, 1, "Late first failure"), /superseded/);
  await assert.rejects(publishNightlyAttempt(root, profile, night, response(first), policyConfig, 1), /superseded/);
  await assert.rejects(publishNightlyAttempt(root, profile, night, response(first), policyConfig, 2), /reserved evidence packet/);
  const current = JSON.parse(await readFile(path.join(root, ".runtime", "council-nightly", "attempts", profile, night, "2", "attempt.json"), "utf8"));
  assert.equal(current.status, "prepared");
  assert.equal(current.error, undefined);
  assert.equal(current.evidenceDigest, second.evidenceDigest);
  assert.equal((await publishNightlyAttempt(root, profile, night, response(second), policyConfig, 2)).status, "published");
  assert.equal((await publishNightlyAttempt(root, profile, night, response(second), policyConfig, 2)).alreadyPublished, true);
  assert.equal((await recordNightlyFailure(root, profile, night, policyConfig, 2, "Interrupted publication response")).status, "published");
});

test("long downtime prioritizes current daily work and preserves labeled backfill", async (t) => {
  const root = await fixture(t);
  const now = new Date("2026-10-01T04:00:00Z");
  const plan = await planNightlyCouncils(root, policyConfig, now);
  assert.equal(plan.latestDueNight, "2026-09-30");
  assert.ok(plan.ready.every((row) => row.night === "2026-09-30"));
  assert.equal(plan.pending.length, 14 * profiles.length);
  assert.equal(plan.maxBatches, 7);
  assert.equal(plan.profiles[0].missed.count, 13);
  assert.equal(plan.profiles[0].missed.recent.length, 7);
  await assert.rejects(prepareNightlyAttempt(root, "FreedOS", "2026-09-16", policyConfig, now), /Only due council nights/);
  await assert.rejects(prepareNightlyAttempt(root, "FreedOS", "2026-10-01", policyConfig, now), /Only due council nights/);
  const packet = await prepareNightlyAttempt(root, "FreedOS", night, policyConfig, now);
  assert.equal(packet.nightly.night, night);
  assert.equal(packet.nightly.preparedAt, now.toISOString());
  assert.match(packet.publication, /distinguish a delayed review from historical evidence/);
  await publishNightlyAttempt(root, "FreedOS", night, response(packet), policyConfig, packet.nightly.attempt);
  const next = await planNightlyCouncils(root, policyConfig, now);
  assert.equal(next.pending.length, plan.pending.length - 1);
  assert.ok(!next.pending.some((row) => row.profile === "FreedOS" && row.night === night));
  const receipt = (await loadCouncilState(root, "FreedOS", config)).councilSessions[0];
  assert.match(receipt.summary, /Council night: 2026-09-17.*Reviewed 2026-09-30.*Catch-up review using current evidence/);
});

test("backfill skips cooling and exhausted gaps without hiding them or duplicating published dates", async (t) => {
  const root = await fixture(t), profile = "FreedOS";
  const configuration = { ...policyConfig, profiles: [profile], nightly: { ...nightly, maxAttempts: 1 } };
  await prepareNightlyAttempt(root, profile, night, configuration, due);
  const now = new Date("2026-09-20T04:00:00Z");
  const latestPacket = await prepareNightlyAttempt(root, profile, "2026-09-19", configuration, now);
  await publishNightlyAttempt(root, profile, "2026-09-19", response(latestPacket), configuration, 1);
  let plan = await planNightlyCouncils(root, configuration, now);
  assert.equal(plan.profiles[0].status, "published");
  assert.equal(plan.pending.find((row) => row.night === night).status, "exhausted");
  assert.deepEqual(plan.ready.map((row) => row.night), ["2026-09-18"]);
  const normal = { ...configuration, nightly };
  await prepareNightlyAttempt(root, profile, "2026-09-18", normal, now);
  plan = await planNightlyCouncils(root, normal, now);
  assert.equal(plan.pending.find((row) => row.night === "2026-09-18").status, "cooldown");
  assert.deepEqual(plan.ready.map((row) => row.night), [night]);
});

test("successive bounded batches drain a multi-day backlog and remain empty after restart", async (t) => {
  const root = await fixture(t);
  const now = new Date("2026-09-21T04:00:00Z");
  let published = 0;
  for (let batch = 0; batch < 7; batch++) {
    const plan = await planNightlyCouncils(root, policyConfig, now);
    if (!plan.ready.length) break;
    assert.ok(plan.ready.length <= nightly.batchSize);
    for (const row of plan.ready) {
      const packet = await prepareNightlyAttempt(root, row.profile, row.night, policyConfig, now);
      await publishNightlyAttempt(root, row.profile, row.night, response(packet), policyConfig, packet.nightly.attempt);
      published++;
    }
  }
  assert.equal(published, 4 * profiles.length);
  const restarted = await planNightlyCouncils(root, { ...policyConfig }, now);
  assert.equal(restarted.pending.length, 0);
  assert.equal(restarted.ready.length, 0);
  assert.ok(restarted.profiles.every((row) => row.missed.count === 0));
  await assert.rejects(planNightlyCouncils(root, { ...policyConfig, nightly: { ...nightly, maxBatches: 0 } }, now), /batch limit/);
});

test("a review prepared the next local day records a concise catch-up context", async (t) => {
  const root = await fixture(t), profile = "FreedOS";
  const packet = await prepareNightlyAttempt(root, profile, night, policyConfig, "2026-09-18T07:30:00Z");
  await publishNightlyAttempt(root, profile, night, response(packet), policyConfig, packet.nightly.attempt);
  const receipt = (await loadCouncilState(root, profile, config)).councilSessions[0];
  assert.match(receipt.summary, /^Council night: 2026-09-17 · Reviewed 2026-09-18 00:30 \(America\/Los_Angeles\)\. Catch-up review using current evidence\.\n\nControlled nightly council\.$/);
});
