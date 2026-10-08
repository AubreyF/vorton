// Portable recovery decisions only. Adapters retain lifecycle and publication authority.
import { createHash } from "node:crypto";

const targetKeys = ["workspace", "service", "reservation", "fingerprint"];
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join() === [...keys].sort().join();
}
function origin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value)
    throw new Error("Expected an HTTPS origin without credentials or a path");
  return value;
}

export function validatePolicy(value) {
  if (!exactKeys(value, ["version", "enabled", "target", "maintenanceUntil", "healthOrigin"]) ||
      value.version !== 1 || typeof value.enabled !== "boolean" ||
      !Number.isSafeInteger(value.maintenanceUntil) || value.maintenanceUntil < 0 ||
      !exactKeys(value.target, targetKeys)) throw new Error("Invalid recovery policy");
  const target = {};
  for (const key of targetKeys) {
    const text = value.target[key];
    if (typeof text !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text))
      throw new Error("Invalid recovery target");
    target[key] = text;
  }
  if (!/^[a-f0-9]{64}$/.test(target.fingerprint)) throw new Error("Invalid configuration fingerprint");
  return { version: 1, enabled: value.enabled, target,
    maintenanceUntil: value.maintenanceUntil,
    healthOrigin: value.healthOrigin === null ? null : origin(value.healthOrigin) };
}

export function bindingKey(target) {
  return createHash("sha256").update(JSON.stringify(targetKeys.map(key => target[key]))).digest("hex");
}

function sameTarget(left, right) {
  return exactKeys(left, targetKeys) && targetKeys.every(key => left[key] === right[key]);
}

function validateState(value, binding) {
  if (value === null) return { version: 1, binding, attempts: 0, nextRecovery: 0, failures: 0 };
  if (!exactKeys(value, ["version", "binding", "attempts", "nextRecovery", "failures"]) ||
      value.version !== 1 || value.binding !== binding ||
      ![value.attempts, value.nextRecovery, value.failures].every(n => Number.isSafeInteger(n) && n >= 0) ||
      value.attempts > 1_000_000 || value.failures > 3)
    throw new Error("Invalid recovery state or changed binding");
  return { ...value };
}

// Typed application failure must originate in a trusted adapter. Unknown errors
// and explicit stops never become recovery authority, even with opt-in enabled.
function eligible(status, target) {
  return sameTarget(status?.target, target) && status.desired === "running" &&
    status.stopProvenance === null &&
    (status.status === "ready" ||
      (status.status === "failed" && status.error === "ApplicationUnavailable"));
}

export function createRecoveryController({ readPolicy, withLease, loadState, saveState,
  inspect, healthy, recover, now = Date.now }) {
  for (const callback of [readPolicy, withLease, loadState, saveState, inspect, healthy, recover, now])
    if (typeof callback !== "function") throw new Error("All recovery adapter callbacks are required");
  let pending = Promise.resolve();
  const clock = () => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0) throw new Error("Invalid recovery clock");
    return time;
  };
  async function tick() {
    const policy = validatePolicy(await readPolicy());
    if (!policy.enabled) return "disabled";
    const binding = bindingKey(policy.target);
    return withLease(binding, async () => {
      const current = validatePolicy(await readPolicy());
      if (JSON.stringify(current) !== JSON.stringify(policy)) return "policy changed";
      if (current.maintenanceUntil > clock()) return "maintenance";
      const state = validateState(await loadState(binding), binding);
      const status = await inspect(current.target);
      if (!eligible(status, current.target)) return "blocked";
      const primary = origin(status.origin);
      if (status.status === "ready" && await healthy(primary)) {
        await saveState(binding, { ...state, attempts: 0, nextRecovery: 0, failures: 0 });
        if (current.healthOrigin && current.healthOrigin !== primary &&
            !await healthy(current.healthOrigin)) return "custom origin unavailable";
        return "healthy";
      }
      state.failures = Math.min(3, state.failures + 1);
      if (state.failures < 3 || clock() < state.nextRecovery) {
        await saveState(binding, state);
        return "waiting";
      }
      // Re-read after slow health checks. The adapter must also compare these
      // preconditions under its managed lifecycle lock before any mutation.
      const fresh = validatePolicy(await readPolicy());
      if (JSON.stringify(fresh) !== JSON.stringify(current)) return "policy changed";
      if (fresh.maintenanceUntil > clock()) return "maintenance";
      const latest = await inspect(fresh.target);
      if (!eligible(latest, fresh.target) || origin(latest.origin) !== primary ||
          latest.status !== status.status || latest.error !== status.error) return "status changed";
      state.nextRecovery = clock() + Math.min(900_000, 60_000 * 2 ** Math.min(state.attempts, 4));
      state.attempts = Math.min(1_000_000, state.attempts + 1);
      state.failures = 0;
      // Persist intent first. A lost response must not bypass cooldown on retry.
      await saveState(binding, state);
      await recover({ policy: fresh, expected: latest, binding });
      return "recovery requested";
    });
  }
  return () => {
    const result = pending.then(tick);
    pending = result.catch(() => {});
    return result;
  };
}
