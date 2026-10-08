# Changelog

## Unreleased

- Update the locked source-map-js dependency to 1.2.2 to address GHSA-68fv-2mgg-jv7q.

- Add an opt-in portable recovery controller with explicit adapter preconditions, persisted retry cooldown, maintenance checks, and no installation-specific transport or scheduler.

- Combine Tasks, Goals, and Ideas in Forge with quick capture, shared project and tag filters, readiness, and optional value, complexity, effort, upkeep, confidence, and personal pull assessments.
- Retain legacy opportunity records and history. Graduate ideas explicitly into new or existing goals, link experiments to ideas, and require owner acceptance of Council proposals to create, refine, or graduate ideas.
- Use Bridge, Council, Forge, Finance, Tools, and Admin in the shared navigation. Redirect old planning links into Forge and place Organization under Admin.

- Show only the active workspace icon in the mobile switcher, falling back to the first letter of its display name. Keep the full name accessible and preserve desktop labels.

- Fill private installation icon symbols in solid white so their interiors contrast with the titanium background; refresh icon URLs for Safari installation.

- Round browser favicon corners, refresh private workspace icon URLs, serve installation manifests as JSON, and provide a high-resolution Apple touch icon. Replace the stale shared A fallback with the neutral Vorton mark.

- Hide repeated page titles on mobile while preserving accessible headings, descriptions and actions. Compact mobile tool cards with icons and status on the left and titles and descriptions on the right.

- Prefix the private AubOS and FreedOS navbar labels with their selected falcon and F silhouettes, inheriting the label color and scale through the shared workspace selector.

- Gate daily Omi Council review on a completed bounded scan, preserving unverified cloud coverage and deferring failures before review admission. Index encrypted archives by opaque day tokens, cache encrypted evidence pages, and bound historical metadata selection so routine reads do not decrypt years of transcripts.

- Add workspace-specific titanium favicons and Safari installation icons to the private AubOS and FreedOS frontend, with separate web-app identities and high-resolution maskable artwork.
- Preserve legacy Admin page titles and not-found titles when attaching native workspace metadata.

- Keep completed planning history out of the daily Council context beyond explicit recent windows, while preserving all unfinished work and unresolved proposals. Prioritize the current due Council before historical catch-up.

- Allow native Council publication to use explicit, owner-recorded exceptions for unchanged historical evidence references. Keep new references and planning changes under strict validation, and include unavailable evidence in review packets and audit reports.

- Lead Council pages with the timeline, fade its viewport edges, and group goal details into sub-cards with the agent prompt action on the right. Remove repeated persona disclaimers from Council reading surfaces and future review prompts.

- Redesign Omi setup around connection, archive and Council state, with one atomic Save changes action shared with Admin settings. Keep unreviewed transcript versions queued across failed reviews and late arrivals, and acknowledge them only after a durable Council receipt.

- Reorganize Admin into a shared directory with independent settings, integrations, Omi, data exports, activity and decision pages. Keep native review and evidence destinations separate instead of appending unrelated panels below Review.

- Explain where to generate a restricted Omi Developer key directly in Admin, including one-time secret display and replacement instructions.

- Add workspace-scoped Omi administrative setup, encrypted credential and transcript storage, bounded direct API retrieval, historical backfill and manual replay. Keep model processing in the existing Paseo workflow and make unverified source coverage explicit.

- Reset Omi scan offsets and evidence receipts when deleting local history, and surface historical retrieval failures in Council evidence.

- Preserve productive Omi backfill progress across multiple weeks instead of restarting it on a weekly timer.

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
