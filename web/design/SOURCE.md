# Design source

Forge, October 7, 2026: `web/forge.tsx` reuses the shared workspace navigation, goal panels, form controls and dialog styling. `web/forge.css` composes those elements into responsive cards and a capture bar using inherited theme tokens. Workspace adapters supply routes and records without separate appearance controls.

The shared header and installation selector accept an optional presentation-only brand symbol. Private workspace adapters supply their own silhouettes; private artwork is not embedded in this portable design layer. Symbols inherit the wordmark's color and font-relative size, with no independent theme setting.

Omi refinement, September 30, 2026: `web/omi-admin.tsx` uses the existing panel, form, type and color tokens. Its status row, two-column preference rows and maintenance disclosures are original compositions of those components. `web/admin-save.tsx` supplies one shared submit footer for editable Admin pages; no separate theme or toolbar was introduced.

Admin redesign, September 29, 2026: `web/admin-page.tsx` and its stylesheet reuse the shared Tools directory's card/navigation pattern and existing shell tokens. The compact inline symbols are original SVG controls. Native adapters contribute organization-specific evidence links; the shared directory contains no private organization logic or records.

The owner authorized reuse of the reviewed visual vocabulary for portable Vorton and The Last Resort under the repository's MIT license. These individually selected design files contain interface tokens and components, not personal records or private installation logic. Their source hashes are recorded below.

- `web/design/themes.css`: source `dashboard/web/app/themes.css`, SHA-256 `ee5368013004c1e84011eaa8e06289fb8a521a18bb9c82f5430e0ae9d0aed978`.
- `web/design/theme-registry.ts`: source `dashboard/web/app/design-system/theme-registry.ts`, SHA-256 `0b41ea5dbdac3fffc8086467258d6b14ce48d0fec3d5fb7d80a110669b3854b8`.
- `web/design/icons.tsx`: source `dashboard/web/app/design-system/icons.tsx`, SHA-256 `f96b4f7438083f8ad343deb754d824829e2fb7b0ef8ae389f3f08ea220e52a59`.

Preserve the six theme identities, semantic tokens, typography, keyboard controls, and reduced-motion behavior. Adaptations live in the local application stylesheet rather than silently changing these reference tokens.

The Last Resort additions, September 18, 2026:

- The reviewed application header, installation switcher, theme controls, interface zoom, background atmosphere, menu selection spacing, and shell stylesheet now live here as shared primitives. Native design-system files re-export them; they no longer maintain a second implementation. `workspace-navigation.tsx` extracts the existing native workspace navigation unchanged in behavior. Theme registry and theme CSS are shared by both entry points.
- `fonts.css` and the selected `fonts/*.woff2` assets reuse the six families already shipped by the native application. Files are unmodified; family-specific SIL Open Font License notices are retained alongside them. The font software remains under those licenses, independent of the application's MIT license. No font request goes to a third-party service at runtime.
- `web/design/section-navigator.tsx`: selected source `dashboard/web/app/design-system/section-navigator.tsx`, SHA-256 `468cb79babc2deb2fd2f65a5348d0ba974bbc124f225283c5e0611bf8c71ddab`. Contains generic scrolling and section links, with no private records or installation adapters.
- `web/main.tsx` composes the shared header and navigation directly. It does not implement separate menu controls or an organization-specific appearance preference. No personal application directory was copied.
- `web/installed-version.tsx` is an original shared control placed after all other menu contents. It reads the running server's version and reports unavailable telemetry honestly.
- `demo/last-resort` contains original fictional writing created for the owner's requested flagship. Council portraits use the existing deterministic inline SVG component. No external images or private records are included.

Council presentation additions, September 18, 2026:

- `web/council-views.tsx` and `web/council-views.css` provide the owner-selected Roundtable using reviewed AubOS color, typography, control, and surface tokens. The earlier Salon and Dispatch implementations were removed. Roundtable reuses existing council session and recommendation records, the report renderer, and organization routes.
- `web/council-avatar.tsx` contains original inline SVG cartoon portraits drawn for the nine built-in council identities, plus deterministic portraits for custom identities. Portrait colors are illustration pigments, independent of interface status colors. No third-party artwork, remote images, fonts, image service, or API key is required.
- `web/council-timeline.tsx` provides the continuous calendar with a bounded date window, and `web/council-calendar.tsx` provides the floating date picker. `web/council-briefing.tsx` loads the latest profile-scoped briefing for the native Bridge; the shared Bridge uses its existing state. The owner-selected Orrery shares the portraits' oval geometry and uses bounded SVG orbital curves. These presentation controls do not schedule sessions, publish council output, or accept recommendations.
- `web/council-decisions.tsx` reuses the previous recommendation page's evidence, proposed record, prompt, and action controls. Its profile-wide queue is outside the selected session component. `web/council-decisions.css` uses the same reviewed AubOS tokens.
