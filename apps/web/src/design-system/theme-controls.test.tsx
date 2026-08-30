import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppearanceTileStrip } from "./theme-controls.js";
import { APPEARANCE_DEFINITIONS } from "./theme-registry.js";

describe("appearance tile strip", () => {
  it("offers every registered appearance before authentication", () => {
    const html = renderToStaticMarkup(<AppearanceTileStrip />);

    expect(html.match(/role="radio"/g)).toHaveLength(
      APPEARANCE_DEFINITIONS.length,
    );
    for (const appearance of APPEARANCE_DEFINITIONS) {
      expect(html).toContain(`aria-label="${appearance.name}"`);
    }
    expect(html).toContain('aria-checked="true"');
  });
});
