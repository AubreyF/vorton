import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type HorizontalOverflow = {
  left: boolean;
  right: boolean;
};

export function readHorizontalOverflow({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): HorizontalOverflow {
  return {
    left: scrollLeft > 1,
    right: scrollLeft + clientWidth < scrollWidth - 1,
  };
}

export function horizontalNavigationScrollOffset(
  clientWidth: number,
  direction: -1 | 1,
) {
  return direction * Math.max(180, clientWidth * 0.72);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useHorizontalNavigation(contentKey: string) {
  const ref = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState<HorizontalOverflow>({
    left: false,
    right: false,
  });

  const updateOverflow = useCallback(() => {
    const navigation = ref.current;
    if (!navigation) return;

    const next = readHorizontalOverflow(navigation);
    setOverflow((current) =>
      current.left === next.left && current.right === next.right
        ? current
        : next,
    );
  }, []);

  const scroll = useCallback((direction: -1 | 1) => {
    const navigation = ref.current;
    if (!navigation) return;

    navigation.scrollBy({
      left: horizontalNavigationScrollOffset(navigation.clientWidth, direction),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  useEffect(() => {
    const navigation = ref.current;
    if (!navigation) return;

    const frame = requestAnimationFrame(updateOverflow);
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(navigation);
    if (navigation.firstElementChild) {
      observer.observe(navigation.firstElementChild);
    }
    window.addEventListener("resize", updateOverflow);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [contentKey, updateOverflow]);

  return { ref, overflow, scroll, updateOverflow };
}

export function HorizontalNavigation({
  activeKey,
  activeSelector = ".nav-button.active",
  children,
  label,
  navigationClassName,
  shellClassName,
  trackClassName,
}: {
  activeKey: string;
  activeSelector?: string;
  children: ReactNode;
  label: string;
  navigationClassName?: string;
  shellClassName?: string;
  trackClassName?: string;
}) {
  const leftControlRef = useRef<HTMLButtonElement>(null);
  const rightControlRef = useRef<HTMLButtonElement>(null);
  const { ref, overflow, scroll, updateOverflow } =
    useHorizontalNavigation(activeKey);

  const preserveControlFocus = useCallback(
    (control: HTMLButtonElement, fallback: () => HTMLElement | null) => {
      if (document.activeElement !== control) return;

      const startedAt = performance.now();
      const transferWhenRemoved = () => {
        if (!control.isConnected) {
          fallback()?.focus({ preventScroll: true });
          return;
        }
        if (performance.now() - startedAt < 750) {
          requestAnimationFrame(transferWhenRemoved);
        }
      };
      requestAnimationFrame(transferWhenRemoved);
    },
    [],
  );

  const activeNavigationItem = useCallback(
    () => ref.current?.querySelector<HTMLElement>(activeSelector) ?? null,
    [activeSelector],
  );

  useEffect(() => {
    const navigation = ref.current;
    if (!navigation) return;

    const frame = requestAnimationFrame(() => {
      activeNavigationItem()?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "nearest",
        inline: "nearest",
      });
      updateOverflow();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeKey, activeNavigationItem, ref, updateOverflow]);

  const shellClasses = ["view-nav-shell", shellClassName]
    .filter(Boolean)
    .join(" ");
  const navigationClasses = ["view-nav", navigationClassName]
    .filter(Boolean)
    .join(" ");
  const trackClasses = ["view-nav-track", trackClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClasses}>
      {overflow.left && (
        <button
          ref={leftControlRef}
          className="nav-scroll-control nav-scroll-left"
          type="button"
          aria-label={`Scroll ${label} left`}
          onClick={(event) => {
            preserveControlFocus(
              event.currentTarget,
              () => rightControlRef.current ?? activeNavigationItem(),
            );
            scroll(-1);
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
      )}
      <nav
        ref={ref}
        className={navigationClasses}
        aria-label={label}
        onScroll={updateOverflow}
        data-overflow-left={overflow.left ? "true" : undefined}
        data-overflow-right={overflow.right ? "true" : undefined}
      >
        <div className={trackClasses}>{children}</div>
      </nav>
      {overflow.right && (
        <button
          ref={rightControlRef}
          className="nav-scroll-control nav-scroll-right"
          type="button"
          aria-label={`Scroll ${label} right`}
          onClick={(event) => {
            preserveControlFocus(
              event.currentTarget,
              () => leftControlRef.current ?? activeNavigationItem(),
            );
            scroll(1);
          }}
        >
          <span aria-hidden="true">›</span>
        </button>
      )}
    </div>
  );
}
