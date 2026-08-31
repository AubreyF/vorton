import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { HorizontalNavigation } from "./horizontal-navigation.js";

export interface SectionNavigationItem {
  id: string;
  label: string;
  route: string;
  detail?: string;
}

function navigationOffset() {
  const primaryNavigation = document.querySelector<HTMLElement>(".topbar");
  return (primaryNavigation?.getBoundingClientRect().bottom ?? 0) + 24;
}

function nearestSection(items: readonly SectionNavigationItem[]) {
  const sections = items
    .map((item) => document.getElementById(item.id))
    .filter((section): section is HTMLElement =>
      Boolean(section instanceof HTMLElement),
    );

  if (sections.length === 0) return "";
  const offset = navigationOffset();
  return sections.reduce((closest, section) =>
    Math.abs(section.getBoundingClientRect().top - offset) <
    Math.abs(closest.getBoundingClientRect().top - offset)
      ? section
      : closest,
  ).id;
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

export function SectionNavigator({
  children,
  items,
  label,
  requestedId,
  onNavigate,
}: {
  children: ReactNode;
  items: readonly SectionNavigationItem[];
  label: string;
  requestedId: string;
  onNavigate(route: string): void;
}) {
  const [activeId, setActiveId] = useState(requestedId || items[0]?.id || "");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;

    const updateActiveSection = () => {
      const nextId = nearestSection(items);
      if (nextId) setActiveId(nextId);
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActiveSection);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    const mutationObserver = new MutationObserver(scheduleUpdate);
    if (contentRef.current) {
      mutationObserver.observe(contentRef.current, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      mutationObserver.disconnect();
    };
  }, [items]);

  useEffect(() => {
    if (!requestedId) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(requestedId);
      if (!target) return;
      setActiveId(requestedId);
      target.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [requestedId]);

  const jumpToSection = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    item: SectionNavigationItem,
  ) => {
    event.preventDefault();
    const target = document.getElementById(item.id);
    if (!target) return;
    setActiveId(item.id);
    onNavigate(item.route);
    target.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  };

  const links = items.map((item) => {
    const active = item.id === activeId;
    return (
      <a
        className={
          active ? "section-navigator-link active" : "section-navigator-link"
        }
        href={`#command/${encodeURIComponent(item.route)}`}
        aria-current={active ? "location" : undefined}
        key={item.id}
        onClick={(event) => jumpToSection(event, item)}
      >
        <span>{item.label}</span>
        {item.detail && <small>{item.detail}</small>}
      </a>
    );
  });

  return (
    <div className="section-navigator-layout">
      <nav className="section-navigator-rail" aria-label={label}>
        <p>On this page</p>
        {links}
      </nav>
      <HorizontalNavigation
        activeKey={activeId}
        activeSelector=".section-navigator-link.active"
        label={`${label}, compact`}
        shellClassName="section-navigator-mobile-shell"
        navigationClassName="section-navigator-mobile section-navigator-topbar"
        trackClassName="section-navigator-topbar__track"
      >
        {links}
      </HorizontalNavigation>
      <div ref={contentRef} className="section-navigator-content">
        {children}
      </div>
    </div>
  );
}
