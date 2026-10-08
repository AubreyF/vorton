import test from "node:test";
import assert from "node:assert/strict";
import { bindingKey, createRecoveryController, validatePolicy } from "../operations/recovery/controller.mjs";

function fixture() {
  const f = { time: 1_000_000, stored: null, requests: [], saves: 0, inspections: 0, leases: 0 };
  f.policy = { version: 1, enabled: true,
    target: { workspace: "example-workspace", service: "example-service", reservation: "example-reservation", fingerprint: "a".repeat(64) },
    maintenanceUntil: 0, healthOrigin: null };
  f.status = { target: structuredClone(f.policy.target), desired: "running", stopProvenance: null,
    status: "failed", origin: "https://app.example", error: "ApplicationUnavailable" };
  f.adapter = {
    readPolicy: async () => structuredClone(f.policy),
    withLease: async (binding, run) => { f.leases++; return run(); },
    loadState: async () => structuredClone(f.stored),
    saveState: async (binding, state) => { f.saves++; f.stored = structuredClone(state); },
    inspect: async () => { f.inspections++; return structuredClone(f.status); },
    healthy: async () => false,
    recover: async (request) => { f.requests.push(request); },
    now: () => f.time,
  };
  f.controller = () => createRecoveryController(f.adapter);
  f.tick = f.controller();
  f.attempt = async () => { await f.tick(); await f.tick(); return f.tick(); };
  return f;
}

test("disabled configuration has no lease, state or transport effects", async () => {
  const f = fixture(); f.policy.enabled = false;
  assert.equal(await f.tick(), "disabled");
  assert.equal(f.leases + f.inspections + f.saves + f.requests.length, 0);
});

test("strict policy rejects malformed and installation-style executable fields", () => {
  const f = fixture();
  for (const mutate of [p => p.helper = "/example/helper", p => p.version = 2,
    p => p.enabled = "true", p => p.maintenanceUntil = Infinity,
    p => p.target.workspace = "../other", p => p.target.fingerprint = "unpinned",
    p => p.target.extra = "value", p => p.healthOrigin = "https://user:pass@app.example",
    p => p.healthOrigin = "http://app.example", p => p.healthOrigin = "https://app.example/path"]) {
    const p = structuredClone(f.policy); mutate(p);
    assert.throws(() => validatePolicy(p));
  }
  assert.throws(() => validatePolicy(null));
});

test("all adapter guarantees are required", () => {
  const f = fixture();
  for (const key of Object.keys(f.adapter).filter(k => k !== "now"))
    assert.throws(() => createRecoveryController({ ...f.adapter, [key]: undefined }));
});

test("more than three failures retain capped cooldown through monitor replacement", async () => {
  const f = fixture(); const delays = [];
  for (let n = 0; n < 6; n++) {
    const observations = [await f.tick(), await f.tick(), await f.tick()];
    assert.ok(observations.includes("recovery requested"));
    delays.push(f.stored.nextRecovery - f.time);
    assert.equal(f.requests.length, n + 1);
    f.tick = f.controller();
    assert.equal(await f.attempt(), "waiting");
    assert.equal(f.requests.length, n + 1);
    f.time = f.stored.nextRecovery;
  }
  assert.deepEqual(delays, [60000, 120000, 240000, 480000, 900000, 900000]);
});

test("uncertain recovery saves cooldown before transport and prevents immediate retry", async () => {
  const f = fixture();
  f.adapter.recover = async () => {
    assert.equal(f.stored.attempts, 1);
    assert.equal(f.stored.nextRecovery, f.time + 60000);
    throw new Error("lost response");
  };
  f.tick = f.controller();
  await assert.rejects(f.attempt(), /lost response/);
  f.tick = f.controller();
  assert.equal(await f.attempt(), "waiting");
});

test("failed persistence never permits recovery", async () => {
  const f = fixture(); f.adapter.saveState = async () => { throw new Error("disk full"); };
  f.tick = f.controller();
  await assert.rejects(f.attempt(), /disk full/);
  assert.equal(f.requests.length, 0);
});

test("maintenance blocks inspection and expires without erasing cooldown", async () => {
  const f = fixture(); await f.attempt();
  const saved = structuredClone(f.stored); const inspections = f.inspections;
  f.policy.maintenanceUntil = f.time + 30000;
  assert.equal(await f.tick(), "maintenance");
  assert.equal(f.inspections, inspections); assert.deepEqual(f.stored, saved);
  f.time += 30000;
  assert.equal(await f.tick(), "waiting");
  assert.equal(f.requests.length, 1);
});

test("maintenance entered during health check prevents mutation", async () => {
  const f = fixture();
  await f.tick(); await f.tick();
  f.status.status = "ready";
  f.adapter.healthy = async () => { f.policy.maintenanceUntil = f.time + 60000; return false; };
  f.tick = f.controller();
  assert.equal(await f.tick(), "policy changed");
  assert.equal(f.requests.length, 0);
  assert.equal(await f.tick(), "maintenance"); assert.equal(f.requests.length, 0);
});

test("policy revocation during final validation prevents mutation", async () => {
  const f = fixture(); await f.tick(); await f.tick();
  let reads = 0;
  f.adapter.readPolicy = async () => {
    if (++reads === 3) f.policy.enabled = false;
    return structuredClone(f.policy);
  };
  f.tick = f.controller();
  assert.equal(await f.tick(), "policy changed"); assert.equal(f.requests.length, 0);
});

test("explicit stop, unknown failure, wrong target, and pending status stay blocked", async () => {
  for (const change of [s => s.desired = "stopped", s => s.stopProvenance = "owner",
    s => s.status = "stopped", s => s.status = "pending", s => s.error = "OwnershipConflict",
    s => s.target.workspace = "another-workspace", s => s.target.reservation = "another-reservation",
    s => s.target.fingerprint = "b".repeat(64)]) {
    const f = fixture(); change(f.status);
    assert.equal(await f.attempt(), "blocked"); assert.equal(f.requests.length, 0);
  }
});

test("stop arriving between observations prevents recovery", async () => {
  const f = fixture(); await f.tick(); await f.tick();
  let reads = 0;
  f.adapter.inspect = async () => {
    if (++reads === 2) f.status.stopProvenance = "owner";
    return structuredClone(f.status);
  };
  f.tick = f.controller();
  assert.equal(await f.tick(), "status changed"); assert.equal(f.requests.length, 0);
});

test("adapter receives exact preconditions and can reject a final race", async () => {
  const f = fixture();
  f.adapter.recover = async request => {
    assert.deepEqual(request.policy, f.policy);
    assert.deepEqual(request.expected, f.status);
    assert.equal(request.binding, bindingKey(f.policy.target));
    throw new Error("preconditions changed under lifecycle lock");
  };
  f.tick = f.controller();
  await assert.rejects(f.attempt(), /preconditions changed/);
  assert.equal(f.stored.attempts, 1);
});

test("healthy service resets attempts and custom origin failure does not restart", async () => {
  const f = fixture(); await f.attempt();
  f.status.status = "ready"; f.policy.healthOrigin = "https://public.example";
  const origins = [];
  f.adapter.healthy = async origin => { origins.push(origin); return origin === f.status.origin; };
  f.tick = f.controller();
  assert.equal(await f.tick(), "custom origin unavailable");
  assert.deepEqual(origins, ["https://app.example", "https://public.example"]);
  assert.equal(f.stored.attempts, 0); assert.equal(f.stored.nextRecovery, 0);
  assert.equal(f.requests.length, 1);
});

test("transport errors and unsafe origins fail closed", async () => {
  const f = fixture(); f.adapter.inspect = async () => { throw new Error("unavailable"); };
  f.tick = f.controller(); await assert.rejects(f.tick(), /unavailable/);
  assert.equal(f.requests.length, 0);
  const g = fixture(); g.status.origin = "http://app.example";
  await assert.rejects(g.tick(), /HTTPS/); assert.equal(g.requests.length, 0);
});

test("state from a different target or corrupt cooldown is rejected", async () => {
  const f = fixture(); await f.tick();
  const saved = structuredClone(f.stored);
  for (const patch of [{ binding: "other" }, { attempts: -1 }, { nextRecovery: NaN }, { failures: 4 }, { unexpected: true }]) {
    f.stored = { ...saved, ...patch };
    await assert.rejects(f.tick(), /Invalid recovery state/);
  }
  assert.equal(f.requests.length, 0);
});

test("lease contention prevents all state and transport access", async () => {
  const f = fixture(); f.adapter.withLease = async () => { throw new Error("owned"); };
  f.tick = f.controller(); await assert.rejects(f.tick(), /owned/);
  assert.equal(f.inspections + f.saves + f.requests.length, 0);
});

test("overlapping ticks are serialized and respect persisted cooldown", async () => {
  const f = fixture(); let active = 0; let maximum = 0;
  f.adapter.withLease = async (key, run) => {
    active++; maximum = Math.max(maximum, active);
    try { await new Promise(resolve => setImmediate(resolve)); return await run(); }
    finally { active--; }
  };
  f.tick = f.controller(); await Promise.all(Array.from({ length: 12 }, () => f.tick()));
  assert.equal(maximum, 1); assert.equal(f.requests.length, 1);
});
