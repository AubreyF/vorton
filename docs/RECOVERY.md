# Recovery adapter contract

`operations/recovery/controller.mjs` provides opt-in recovery decisions for a managed service. It has no default target, executable path, credentials, filesystem store, timer, or lifecycle transport. Importing it starts nothing. Installation adapters remain outside portable core.

The controller generalizes the reviewed installation's persisted retry intent, capped backoff, maintenance checks, and separate custom-origin health check. It does not install the Mac restoration job or patch an HTTPS broker. Those tools depend on private service registrations and host ownership controls.

## Configuration

Supply a private policy through `readPolicy`. All fields below are required; unknown fields are rejected. These are fictional identifiers, not working installation settings.

```json
{
  "version": 1,
  "enabled": false,
  "target": {
    "workspace": "example-workspace",
    "service": "example-service",
    "reservation": "example-reservation",
    "fingerprint": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "maintenanceUntil": 0,
  "healthOrigin": null
}
```

The adapter computes the SHA256 fingerprint from its canonical service definition. It must include every field that affects execution or ownership. A configuration change requires explicit re-pinning and review of retained recovery state. The reservation is an opaque stable identifier, not an instruction to allocate a port. `maintenanceUntil` is an absolute epoch time in milliseconds. `healthOrigin` is either null or a strict HTTPS origin. Store configuration, fingerprints, and state outside Git.

## Required callbacks

`createRecoveryController` returns one asynchronous tick. The installation supplies its cadence and every callback below. The module adds no scheduler or daemon.

- `readPolicy()` returns the current policy from an owner-controlled source. Missing or malformed policy fails closed.
- `withLease(binding, run)` grants exclusive ownership across all monitor processes and holds it until `run` settles. Reject contention. Never invoke `run` twice. The adapter must preserve singleton service ownership even across configuration changes. Do not delete a live owner's lock to recover a stale monitor.
- `loadState(binding)` returns null for a new binding or its stored state. `saveState(binding, state)` atomically and durably persists it before resolving. Retain state across monitor replacement. State includes its binding and rejects accidental cross-target reuse.
- `inspect(target)` returns `{ target, desired, stopProvenance, status, origin, error }` from the managed lifecycle authority. `target` must exactly match the policy. Eligible status is `ready`, or `failed` with the typed error `ApplicationUnavailable`. Recovery also requires `desired: "running"` and `stopProvenance: null`. Unknown failures, pending services, changed identities, and explicit stops remain blocked.
- `healthy(origin)` verifies the intended application and rendered entry route at the supplied HTTPS origin. Reject cross-origin redirects. A bare TCP connection or generic HTTP 200 is insufficient. Throwing fails closed.
- `recover({ policy, expected, binding })` requests recovery of that exact service through supported controls. Under its own lifecycle lock, the adapter must recheck the current policy, maintenance deadline, running intent, stop provenance, target fingerprint, process/listener ownership, and reservation against the supplied preconditions. Reject changed preconditions. Preserve origin, publication, workspace isolation, and Funnel protections. Return only after the managed request has settled, or throw if its result is uncertain.
- `now()` optionally supplies epoch milliseconds for testing; production defaults to `Date.now`.

Controller serialization does not replace the cross-process lease or an atomic lifecycle precondition check. Do not wire an unconditional shell restart into `recover`. This patch intentionally supplies no production adapter until those guarantees can be verified for its platform.

## Behavior and verification

Three eligible unhealthy observations permit a recovery attempt. Retry cooldowns are 60, 120, 240, 480, then 900 seconds, continuing at 900 seconds without a permanent three-attempt cutoff. The controller persists intent before recovery, including when a response is lost. Maintenance, disabled policy, and blocked status do not reset the cooldown or accumulated observations. A successful application health check resets retry state. A custom-origin outage reports separately and does not restart a healthy application.

Explicit stops remain stopped. This is deliberately narrower than a private installation policy that authorizes restarting stopped registrations. Preserve stop provenance in the broker; never infer owner intent solely from a generic stopped label.

Run `node --test tests/recovery.test.mjs`, then the repository checks. The tests use in-memory fixtures and make no network or lifecycle calls. They establish portable decision behavior, not installed service recovery or an availability SLA. Each future adapter needs independent review and isolated failure, contention, maintenance, state durability, and stale-precondition tests before installation.
