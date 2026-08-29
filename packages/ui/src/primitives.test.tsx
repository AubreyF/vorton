import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, EmptyState, StatusDot } from "./primitives.js";

describe("control-plane primitives", () => {
  it("renders status tone and accessible empty-state guidance", () => {
    const html = renderToStaticMarkup(
      <EmptyState eyebrow="Tools / Installed" title="No tools installed">
        <p>Open Tool Lab to preview examples.</p>
      </EmptyState>,
    );
    expect(html).toContain("No tools installed");
    expect(html).toContain("Open Tool Lab");
    expect(renderToStaticMarkup(<StatusDot tone="warn" />)).toContain(
      "status-dot--warn",
    );
    expect(
      renderToStaticMarkup(<Badge tone="blue">Observe only</Badge>),
    ).toContain("Observe only");
  });
});
