import test from "node:test";
import assert from "node:assert/strict";
import { OmiClient, pacificDay, previousDay } from "../server/omi-client.mjs";

const key = "omi_dev_SYNTHETIC_TEST_ONLY";
test("Omi transport fixes host and method, bounds pages and uses explicit UTC dates", async () => {
  const client = new OmiClient(key, { fetcher: async (url, init) => {
    assert.equal(url.origin, "https://api.omi.me"); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(url.searchParams.get("limit"), "25"); assert.equal(url.searchParams.get("offset"), "25");
    return Response.json([{ id: "synthetic" }]);
  }});
  assert.equal((await client.list({ ...pacificDay("2026-03-08"), offset: 25 })).length, 1);
  await assert.rejects(client.list({ limit: 100 }), /page size/);
});
test("Omi errors never echo response text or transport secrets and honor long retry windows", async () => {
  const now = Date.parse("2026-09-28T00:00:00Z");
  const client = new OmiClient(key, { clock: () => now, fetcher: async () => new Response("PRIVATE_CANARY", { status: 429, headers: { "Retry-After": "3600" } }) });
  await assert.rejects(client.list({}), error => error.code === "http_429" && error.retryAt === "2026-09-28T01:00:00.000Z" && !error.message.includes("CANARY"));
  const broken = new OmiClient(key, { fetcher: async () => { throw Error(key); } });
  await assert.rejects(broken.list({}), error => error.code === "transport" && !error.message.includes(key));
});
test("Omi rejects malformed, oversized and non-JSON successful responses", async () => {
  for (const response of [Response.json({ data: [] }), new Response("PRIVATE_CANARY"), new Response("x".repeat(8 * 1024 * 1024 + 1), { headers: { "Content-Type": "application/json" } })]) {
    await assert.rejects(new OmiClient(key, { fetcher: async () => response }).list({}), error => !error.message.includes("CANARY"));
  }
});
test("Pacific days preserve spring/fall transitions and previous calendar date", () => {
  for (const [day, hours] of [["2026-03-08", 23], ["2026-11-01", 25], ["2026-09-28", 24]]) {
    const { start, end } = pacificDay(day); assert.equal((Date.parse(end) - Date.parse(start)) / 3600000, hours);
  }
  assert.equal(previousDay("2026-03-01"), "2026-02-28");
  assert.throws(() => pacificDay("2026-02-30"), /Invalid/);
});
