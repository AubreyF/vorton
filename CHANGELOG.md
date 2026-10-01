# Changelog

## Unreleased

- Add guarded recovery for an unpublished Factory attempt whose approved base advanced. Preserve its claim, scheduler run, custody history and original workspace while preparing a separately approved base revision. Incomplete metadata transactions block controller startup.

- Automatically queue missing Council dates from activation onward, oldest first, with labeled current-evidence catch-up reports. Drain bounded batches on each heartbeat while preserving receipt deduplication, profile isolation, cooldowns, and retry limits.

## 0.2.0-preview.5, September 28, 2026

- Patch the dependency trees used by local validation and production builds. Keep the existing Vinext integration and pin its image parser to a patched compatible release.
- Use compact loading indicators for embedded Bridge cards so loading a Council briefing or vocabulary card does not reserve a full viewport.
- Reveal the Council body after its lazy history loads, preventing Goals and Review from jumping down when the Roundtable arrives. Preserve section links and the Roundtable layout.

## 0.2.0-preview.4, September 19, 2026

- Update the installed React runtime and server decoder to 19.2.8 to fix CVE-2026-44907 before the private production rollout. Keep application releases independent of governed evidence refreshes.

## 0.2.0-preview.3, September 19, 2026

- Preserve restoration of older backups when additive business fields are absent, and initialize new preference histories consistently.
- Defer the Bridge vocabulary card's code and styles until that view mounts.
- Add saved Opportunities, Finance, and Admin & Activity sections using the shared workspace shell. Keep pipeline estimates, ledger entries, and forecast assumptions separate.
- Seed three fictional opportunities and four ledger entries in new Last Resort demo stores. Existing stores retain their records and gain empty optional business collections on read.
- Add workspace purpose and default owner settings, scoped exports, record editing history, and opportunity-to-Task drafts.

## 0.2.0-preview.2, unreleased

- Load shared shell styles once per application entry, preserve explicit navigation button behavior, and audit accessibility through the shared components.
- Require a trusted host, project, and repository binding before Factory queue admission and attempt preparation. Removed or mismatched projects hold work without recreating them.
- Retain Factory workspace membership across retries and recovery. Uncertain workspace creation and removed registrations hold for reconciliation instead of creating duplicates.
- Add a shared Tools shelf with Last Resort room-shuffle and breakfast planners, explicit assumptions, bounded calculations, and editable Task drafts.
- Replace the separate Last Resort shell with shared workspace toolbar, menu, theme, zoom, navigation, fonts, and background components. Share appearance across organizations and replace static demo copy with record-driven Bridge and Organization views.

## 0.2.0-preview.1, September 18, 2026
- Compress Last Resort static assets with the shared production delivery policy while preserving private response freshness and workspace isolation.
- Adopt the MIT license for the portable Vorton preview.
- Configure the local Council due time for 4 a.m. Pacific; matching heartbeat activation remains pending scheduler admission recovery.
- Repair relocated font caches before application builds so reviewed fonts load from production assets without refreshing evidence or downloading replacements.
- Enlarge the Council Orrery on desktop and phone while retaining crossing orbits and portrait clearance.
- Refine Council into a single illustrated Roundtable with an aligned Orrery, animated anchored submissions, a viewport-wide historical timeline, and a calendar picker.
- Keep Council decisions across daily sessions, add a visible report preview with in-place expansion, and reuse section navigation for Timeline, Roundtable, Report, Goals, and Review.
- Support persistent nightly Council heartbeats with profile-scoped publication receipts and bounded recovery, without spawning workspaces for each run.
- Size the Council orrery from the responsive identity ring, preserving its orbit shapes and portrait clearance.
- Restore crossing orbits beyond the outer circles. Replace dense session previews with recorded next decisions, an animated report accordion, and an accent ghost toggle.
- Remove repository quota verification and weekly allowance floors; future controls belong in the Paseo scheduler.
- Fix theme link defaults overriding button and navigation text colors in the installed AubOS interface.
- Add The Last Resort, a fictional hotel workspace with populated Goals, Tasks, staff, and Council recommendations.
- Add a standalone portable demo host with explicit workspace admission and isolated runtime state.
- Show the installed process version as the final item in the upper-left menu.
- Prepare an explicit portable source inventory and release audit workflow. Publication remains gated on owner confirmation.
- Preserve restoration of older two-installation backups while allowing the added demonstration workspace.
