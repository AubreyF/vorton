import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountMenu, accountInitial } from "./account-menu.js";
import { APPEARANCE_DEFINITIONS } from "./theme-registry.js";

describe("account menu", () => {
  it("consolidates appearance, tools, and account actions behind the avatar", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        email="operator@example.com"
        installationName="FreedOS"
        onSignOut={() => undefined}
      />,
    );

    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).toContain(
      '<button type="button" class="account-menu-trigger"',
    );
    expect(html).toContain(
      'aria-label="Account menu for operator@example.com"',
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="[^"]+"/);
    expect(html).toContain("Appearance");
    expect(html).toContain("Interface zoom");
    expect(html).toContain("Tools");
    expect(html).toContain("Export page");
    expect(html).toContain("PNG");
    expect(html).toContain("PDF");
    expect(html).toContain("Account");
    expect(html).toContain("operator@example.com");
    expect(html).toContain("FreedOS");
    expect(html).toContain("Log out");
    expect(html.match(/role="radio"/g)).toHaveLength(
      APPEARANCE_DEFINITIONS.length,
    );
  });

  it("derives a stable avatar initial without inventing an identity", () => {
    expect(accountInitial(" aubrey@example.com")).toBe("A");
    expect(accountInitial(null)).toBe("?");
  });
});
