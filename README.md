# Vorton

Vorton is a local workspace for turning Council recommendations into Goals and Tasks you can inspect, accept, and track. The flagship demonstration is **The Last Resort**, a hotel at the edge of the universe. Checkout is at eleven. Causality is subject to availability.

The demo includes three Goals, five Tasks, four fictional staff members, a Council briefing, and a recommendation awaiting your decision. Its people, evidence, incidents, and figures are invented. Accepting a recommendation creates a local planning record; it does not start an agent or perform external work.

## Vision and provenance

Vorton is building toward sovereign superintelligence for humans and AI-native organizations. The longer-term vision connects frontier models, conversations, tools, workers, and source-grounded memory so that people and organizations can think, create, decide, and learn with continuity. Biomimetic memories, a self-improving software factory, ultra-tier subscription multiplexing, and an elegant visual control plane are aspirations, not all delivered features of this local preview.

This repository is Vorton's main development path. [Vorton Cloud](https://github.com/AubreyF/vorton-cloud) is discontinued, with its source and historical architecture preserved for reference. The [vision and source provenance](docs/VISION.md) identifies what carries forward and separates it from Cloud-specific implementation claims.

Factory execution and resource scheduling are separate [Vorteo](https://github.com/AubreyF/vorteo) work. [AubTown](https://github.com/AubreyF/aubtown) remains a separate software-factory platform and Freed pilot. This portable Vorton core does not include either factory runtime.

## Run locally

Use Node.js 22.13 or newer and npm.

```sh
npm ci
npm run check
npm run demo:seed
npm run demo
```

Open `http://127.0.0.1:47840/lastresort/bridge`. The server listens on loopback. Set `VORTON_DEMO_PORT` to use a different unreserved port. No API key, hosted database, account connection, or model runtime is needed.

The seed command creates fictional records in `.runtime/last-resort`. It refuses to overwrite existing work. New stores otherwise start empty. The source fixtures are checked in; runtime mutations, exports, caches, and screenshots are not.

Use Bridge for active goals, blocked work, next steps, and pending decisions. Organization shows the Council roster and each person's current responsibilities. Goals and Tasks open the underlying records. The shared upper-left menu contains six appearances, interface zoom, and the installed Vorton version at its bottom. Appearance and zoom follow you between workspaces on the same origin.

Tools includes Hilbert’s Overbooking Desk and Breakfast Causality Lab. Both calculate a scenario and can open an editable Task containing the result and assumptions. See [Building workspace tools](docs/TOOLS.md) for the reusable pattern.

Opportunities tracks bookings, events, partnerships, and next actions. Finance separates a USD ledger from a room-economics forecast. Admin & Activity saves workspace preferences, exports records, and shows recent changes. Fresh demo stores include three opportunities and four ledger entries; existing stores keep their data and start these collections empty. Seeding never overwrites an installation. Forecasts use your saved assumptions and exclude pipeline estimates from recorded income.

## Boundaries

Repository work requires no quota verification or weekly allowance floor. Future quota controls belong in the Vorteo scheduler.

This is a one-owner local application. It is not a public multi-user service. Workspace selection scopes application records; it does not create an operating-system sandbox. Keep the local server behind your own access controls and do not expose it directly to the internet.

The portable source candidate contains no private installation adapter, personal records, agent scheduler, or Factory implementation. See [design provenance](web/design/SOURCE.md) for the origin of the shared visual vocabulary.

Vorton is available under the [MIT license](LICENSE). This is an early preview; see [vision and provenance](docs/VISION.md), [security](SECURITY.md), [versioning](docs/VERSIONING.md), and [release gates](docs/RELEASE.md).
