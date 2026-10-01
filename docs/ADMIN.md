# Admin

Editable Admin pages use the shared `AdminSave` footer with one Save changes button. Omi saves a replacement key and preferences atomically, disables submission when unchanged, and separates synchronization and deletion from form submission. Connection, archive coverage and confirmed Council review are distinct states.

Admin is a directory of independent workspace pages. It shares the application header, organization selector, fonts, appearance and zoom settings with the rest of Vorton. It does not create a second toolbar or appearance preference.

The landing page at `/<organization>/admin` contains equal-width cards for Workspace settings, Integrations, Data & exports and Activity. Organizations with saved decision history also expose that destination. Native adapters can contribute a separate Review & evidence group, using links to their existing pages. Those pages retain their records and actions; they are not rendered inside the directory.

| Page | Route suffix | Purpose |
| --- | --- | --- |
| Workspace settings | `/admin/settings` | Edit supported workspace defaults and inspect record provenance. Governed settings remain in their authoritative records. |
| Integrations | `/admin/integrations` | Choose a connection to manage. |
| Omi | `/admin/integrations/omi` | Generate and enter a restricted key, manage synchronization, browse retained history and control deletion. |
| Data & exports | `/admin/exports` | Download planning records. This export does not contain Omi credentials or retained transcripts. |
| Activity | `/admin/activity` | Inspect recent changes and access the complete history through export. |
| Decision history | `/admin/decisions` | Review existing decisions where the organization supports them. |

Every detail page provides a breadcrumb back to Admin. Browser Back, Forward and direct links work without keeping unrelated sections mounted. Old `#activity` and supported `#decisions` links redirect to their dedicated pages. Unknown sections do not fall through to another organization.

The original width mismatch came from composing a native Review page inside a section-navigation container and then appending shared Admin panels outside it. The shared directory now owns one content width; Review and other native evidence views are independent destinations. Omi loads only when its detail page opens, rather than fetching integration state on every Admin visit.

Design provenance is recorded in `web/design/SOURCE.md`. Validation includes equal card/panel widths, independent routes, workspace-scoped requests, old links, browser history, keyboard activation, desktop/mobile overflow, appearance persistence and all six themes. The native acceptance harness also checks organization switching and the separate Review destination. Synthetic settings changes run only in isolated test stores.
