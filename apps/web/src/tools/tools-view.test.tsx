import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { toolRegistry } from "./tool-registry.js";
import { ToolsView } from "./tools-view.js";

describe("Tools view", () => {
  it("renders one focused tile for every registered tool", () => {
    const html = renderToStaticMarkup(
      <ToolsView
        installationName="FreedOS"
        view="Catalog"
        navigate={() => undefined}
      />,
    );

    expect(html).toContain('<h1 id="tools-heading">Tools</h1>');
    expect(html.match(/class="tool-tile"/g)).toHaveLength(toolRegistry.length);
    expect(html).toContain('aria-label="Open Moonbase Triage"');
    expect(html).toContain("moonbase-triage-panel");
    expect(html).not.toContain("Installed tools");
    expect(html).not.toContain("A tool earns installation");
    expect(html).not.toContain(">Build<");
    expect(html).not.toContain(">Runs<");
  });

  it("opens a comprehensive routed view for the selected tool", () => {
    const html = renderToStaticMarkup(
      <ToolsView
        installationName="FreedOS"
        view="moonbase-triage"
        navigate={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="#tools/Catalog"');
    expect(html).toContain("Moonbase Triage");
    expect(html).toContain("Deterministic by design");
    expect(html).toContain("Run synthetic preview");
    expect(html).toContain("Reads no FreedOS data");
    expect(html).toContain("No result yet");
  });
});
