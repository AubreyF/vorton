import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, EmptyState, Mark, StatusDot } from "./primitives.js";

describe("control-plane primitives", () => {
  it("renders status tone and accessible empty-state guidance", () => {
    const html = renderToStaticMarkup(
      <EmptyState eyebrow="Tools / Installed" title="No tools installed">
        <p>Open Tools to preview examples.</p>
      </EmptyState>,
    );
    expect(html).toContain("No tools installed");
    expect(html).toContain("Open Tools");
    expect(renderToStaticMarkup(<StatusDot tone="warn" />)).toContain(
      "status-dot--warn",
    );
    expect(
      renderToStaticMarkup(<Badge tone="blue">Observe only</Badge>),
    ).toContain("Observe only");
  });

  it("uses the neutral Vorton identity in the reusable mark", () => {
    const html = renderToStaticMarkup(<Mark />);
    expect(html).toContain('aria-label="Vorton"');
    expect(html).toContain(">VORTON<");
    expect(html).not.toContain(">AUB<");
  });
});
