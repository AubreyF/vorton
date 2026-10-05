# Vorton

Elegant visual control plane for AI operating systems and software factories. Includes Goals, Tasks, Councils, an App Store, and clean, themeable UX primitives for your agents to customize.

Run it on your own machine. Give your organization a place to plan, review advice, track work, and build its own tools. Vorton is open source and building toward sovereign superintelligence for humans and AI-native organizations.

<img width="900" height="676" alt="vorton-demo-github" src="https://github.com/user-attachments/assets/4683394d-693c-44c4-80d9-10c0a64c58dd" />

## Goals, Tasks, and Councils

- **Bridge.** See active goals, blocked work, next steps, and pending decisions.
- **Goals and Tasks.** Set owners, priorities, milestones, and success criteria. Keep the evidence with the work.
- **Councils.** Review briefings and recommendations with evidence, confidence, and tradeoffs. Accept, edit, defer, or reject proposals. Keep unresolved decisions and past decisions across sessions.
- **Organization.** See your Council roster and each person's responsibilities.

Accepted recommendations create or update local Goals and Tasks. Open the resulting record to inspect what changed. In this preview, acceptance saves a planning record; agent execution requires future integration.

## A Workspace your Agents can Customize

Build on shared UX primitives for navigation, typography, themes, menus, and workspace tools. Six appearances and adjustable zoom come included. Appearance settings follow you between workspaces.

### App Store

The App Store holds tools built for your organization. It currently appears as **Tools** in the interface. The included apps calculate a scenario, show its assumptions, and draft an editable Task.

Have your agents build new apps using the [workspace tool pattern](docs/TOOLS.md). Reuse the shared shell and theme tokens so each app fits the rest of the interface.

## Opportunities and Finance

Track bookings, events, partnerships, and next actions. Record income and expenses in a USD ledger and explore a room-economics forecast with saved assumptions. Pipeline estimates stay separate from recorded income. Admin & Activity includes workspace preferences, record exports, and recent changes.

## Demo Experience

Vorton's included demo org is "The Last Resort" - a hotel at the edge of the universe.
It's ready to play with out of the box. Clone it as the basis for your own custom Vorton organizations. Aubrey personally runs an "AubOS" org to supercharge his personal life, and other experimental orgs for projects and codebases he contributes to. 

## Vorton and Vorteo

[Vorteo](https://github.com/AubreyF/vorteo) extends Paseo with multiple provider accounts, reusable profiles, task goals, message queues, and private cross-device access. It is the companion project for agent control and resource scheduling.

[Vorton Factory](docs/VISION.md#vorton-factory) is the intended home for governed software production: connecting goals to bounded agent work and bringing the results back for review. Factory execution, deeper agent integration, and advanced memory remain under development. The portable Vorton preview does not yet include a Factory runtime.

This repository is Vorton's active development path. [Vorton Cloud](https://github.com/AubreyF/vorton-cloud) preserves the discontinued cloud implementation. [AubTown](https://github.com/AubreyF/aubtown), a separate software factory pilot, is being deprecated. See [vision and provenance](docs/VISION.md) for the longer-term direction and the relationship between these projects.

## Install

### Manual

Install Git, Node.js 22.13 or newer, and npm. Clone, build, seed The Last Resort, and start Vorton:

```sh
git clone https://github.com/AubreyF/vorton.git
cd vorton
npm ci
npm run check
npm run demo:seed
npm run demo
```

Open [The Last Resort](http://127.0.0.1:47840/lastresort/bridge). Set `VORTON_DEMO_PORT` to use a different unreserved port.

The seed command creates fictional records in `.runtime/last-resort` and refuses to overwrite existing work. New stores otherwise start empty. Runtime records, exports, caches, and personal installation data stay outside Git.

### Agent instructions

Your task is to give the user a working Vorton interface.

1. Read `AGENTS.md` in the checkout. For an existing installation, read `.runtime/LOCAL-OPERATIONS.md` when present and preserve its services and records.
2. Check Git, Node.js, and npm. Clone this repository into a new directory, or use the user's existing checkout without discarding changes. Run `npm ci` and `npm run check`. Diagnose failures before continuing.
3. For a fresh demo, run `npm run demo:seed`. If the store already contains work, preserve it and skip seeding. Never delete state to make the seed command pass.
4. Run `npm run demo` in a persistent session. If the default port is occupied, choose an available unreserved port with `VORTON_DEMO_PORT`. Keep the server on loopback.
5. Open `/lastresort/bridge` at the running server's address. Verify that the interface loads and navigation works. A running process alone does not establish success.
6. Give the user the clickable address and explain how to stop and restart the server. Keep the handoff short. If browser access is outside your environment, request that specific check and state what remains unverified.

Provider authentication is unnecessary for this demo. Configure remote access only when the user requests it, following the [security guide](SECURITY.md).

## Status and development

Vorton is an early, one-owner local preview. The server listens on loopback; keep remote access behind your own access controls. Workspace selection scopes application records and does not provide an operating-system sandbox. Review the [security guide](SECURITY.md) before changing how you host it.

- [Build workspace tools](docs/TOOLS.md)
- [Vision and source provenance](docs/VISION.md)
- [Shared design provenance](web/design/SOURCE.md)
- [Versioning](docs/VERSIONING.md)
- [Release gates](docs/RELEASE.md)

Vorton is available under the [MIT license](LICENSE).
