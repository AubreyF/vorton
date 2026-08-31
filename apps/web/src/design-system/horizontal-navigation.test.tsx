import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  HorizontalNavigation,
  horizontalNavigationScrollOffset,
  readHorizontalOverflow,
} from "./horizontal-navigation.js";

describe("horizontal navigation", () => {
  it("uses the AubOS one-pixel overflow tolerance", () => {
    expect(
      readHorizontalOverflow({
        scrollLeft: 0,
        clientWidth: 400,
        scrollWidth: 600,
      }),
    ).toEqual({ left: false, right: true });
    expect(
      readHorizontalOverflow({
        scrollLeft: 1,
        clientWidth: 400,
        scrollWidth: 600,
      }),
    ).toEqual({ left: false, right: true });
    expect(
      readHorizontalOverflow({
        scrollLeft: 200,
        clientWidth: 400,
        scrollWidth: 600,
      }),
    ).toEqual({ left: true, right: false });
  });

  it("scrolls by at least 180 pixels and otherwise 72 percent of the view", () => {
    expect(horizontalNavigationScrollOffset(200, 1)).toBe(180);
    expect(horizontalNavigationScrollOffset(500, 1)).toBe(360);
    expect(horizontalNavigationScrollOffset(500, -1)).toBe(-360);
  });

  it("renders the reusable AubOS scrollport and track contract", () => {
    const html = renderToStaticMarkup(
      <HorizontalNavigation
        activeKey="command"
        activeSelector=".section-navigator-link.active"
        label="FreedOS sections"
        shellClassName="primary-nav-shell"
        navigationClassName="primary-navigation"
        trackClassName="primary-navigation__track"
      >
        <button className="nav-button active" type="button">
          Command Bridge
        </button>
      </HorizontalNavigation>,
    );

    expect(html).toContain('class="view-nav-shell primary-nav-shell"');
    expect(html).toContain('class="view-nav primary-navigation"');
    expect(html).toContain('class="view-nav-track primary-navigation__track"');
    expect(html).toContain('aria-label="FreedOS sections"');
  });
});
