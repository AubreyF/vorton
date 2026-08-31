import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  resolveSelectedWorkspace,
  WorkspaceSwitcher,
  type WorkspaceSwitchOption,
} from "./workspace-switcher.js";

const workspaces = [
  {
    id: "workspace-freed",
    displayName: "FreedOS",
    realm: "organizational",
  },
  {
    id: "workspace-aub",
    displayName: "AubOS",
    realm: "personal",
  },
] as const satisfies readonly WorkspaceSwitchOption[];

describe("workspace switcher", () => {
  it("resolves only an accessible workspace and otherwise uses the first explicit membership", () => {
    expect(
      resolveSelectedWorkspace(workspaces, "workspace-aub")?.displayName,
    ).toBe("AubOS");
    expect(resolveSelectedWorkspace(workspaces, "workspace-unknown")?.id).toBe(
      "workspace-freed",
    );
    expect(resolveSelectedWorkspace([], "workspace-freed")).toBeUndefined();
  });

  it("renders a compact phone-safe menu without moving account controls into it", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSwitcher
        workspaces={workspaces}
        selectedWorkspace={workspaces[0]}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("Switch workspace. Current workspace: FreedOS");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Workspaces"');
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("FreedOS");
    expect(html).toContain("Organization");
    expect(html).toContain("AubOS");
    expect(html).toContain("Personal");
    expect(html).not.toContain("Log out");
    expect(html).not.toContain("Appearance");
  });
});
