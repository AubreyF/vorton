"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  APPEARANCE_DEFINITIONS,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_ID,
  getAppearanceAttributes,
  getAppearanceDefinition,
  resolveAppearanceId,
  type AppearanceDefinition,
  type AppearanceId,
} from "./theme-registry.js";
import {
  formatInterfaceZoom,
  INTERFACE_ZOOM_DEFAULT,
  INTERFACE_ZOOM_MAX,
  INTERFACE_ZOOM_MIN,
  INTERFACE_ZOOM_STEP,
} from "./interface-zoom.js";
import { useInterfaceZoom } from "./interface-zoom-client.js";

function readAppearance(): AppearanceId {
  if (typeof document === "undefined") return DEFAULT_APPEARANCE_ID;
  return resolveAppearanceId(document.documentElement.dataset.theme);
}

function storeAppearance(value: AppearanceId) {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
  } catch {
    return;
  }
}

function applyAppearanceToDocument(next: AppearanceId) {
  const attributes = getAppearanceAttributes(next);
  document.documentElement.dataset.theme = attributes.theme;
  document.documentElement.dataset.surface = attributes.surface;
  document.documentElement.dataset.mode = attributes.mode;
}

const APPEARANCE_TRANSITION_BLUR_OUT_MS = 90;
const APPEARANCE_TRANSITION_BLUR_IN_MS = 210;
const APPEARANCE_TRANSITION_CLEANUP_BUFFER_MS = 40;
let appearanceTransitionToken = 0;
let appearanceSwitchTimer: number | null = null;
let appearanceCleanupTimer: number | null = null;

function clearAppearanceTransitionTimers() {
  if (appearanceSwitchTimer !== null)
    window.clearTimeout(appearanceSwitchTimer);
  if (appearanceCleanupTimer !== null)
    window.clearTimeout(appearanceCleanupTimer);
  appearanceSwitchTimer = null;
  appearanceCleanupTimer = null;
}

function clearAppearanceTransitionStyles() {
  const root = document.documentElement;
  root.removeAttribute("data-theme-transition");
  root.style.removeProperty("--theme-transition-duration");
  root.style.removeProperty("--theme-transition-blur");
  root.style.removeProperty("--theme-transition-opacity");
  root.style.removeProperty("--theme-transition-saturate");
}

function transitionAppearance(next: AppearanceId) {
  const root = document.documentElement;
  const current = resolveAppearanceId(root.dataset.theme);
  clearAppearanceTransitionTimers();
  appearanceTransitionToken += 1;
  const transitionToken = appearanceTransitionToken;

  if (current === next) {
    clearAppearanceTransitionStyles();
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    clearAppearanceTransitionStyles();
    applyAppearanceToDocument(next);
    return;
  }

  root.dataset.themeTransition = "blur-out";
  root.style.setProperty(
    "--theme-transition-duration",
    `${APPEARANCE_TRANSITION_BLUR_OUT_MS}ms`,
  );
  root.style.setProperty("--theme-transition-blur", "7px");
  root.style.setProperty("--theme-transition-opacity", "0.965");
  root.style.setProperty("--theme-transition-saturate", "0.985");

  appearanceSwitchTimer = window.setTimeout(() => {
    if (appearanceTransitionToken !== transitionToken) return;
    applyAppearanceToDocument(next);
    root.dataset.themeTransition = "blur-in";
    root.style.setProperty(
      "--theme-transition-duration",
      `${APPEARANCE_TRANSITION_BLUR_IN_MS}ms`,
    );
    root.style.setProperty("--theme-transition-blur", "0px");
    root.style.setProperty("--theme-transition-opacity", "1");
    root.style.setProperty("--theme-transition-saturate", "1");
    appearanceSwitchTimer = null;

    appearanceCleanupTimer = window.setTimeout(() => {
      if (appearanceTransitionToken !== transitionToken) return;
      clearAppearanceTransitionStyles();
      appearanceCleanupTimer = null;
    }, APPEARANCE_TRANSITION_BLUR_IN_MS + APPEARANCE_TRANSITION_CLEANUP_BUFFER_MS);
  }, APPEARANCE_TRANSITION_BLUR_OUT_MS);
}

function applyAppearance(next: AppearanceId) {
  clearAppearanceTransitionTimers();
  clearAppearanceTransitionStyles();
  applyAppearanceToDocument(next);
  storeAppearance(next);
  window.dispatchEvent(new Event("vorton-appearance"));
}

function subscribeAppearance(onChange: () => void) {
  window.addEventListener("vorton-appearance", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("vorton-appearance", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getAppearanceSnapshot() {
  return readAppearance();
}

function getServerAppearanceSnapshot() {
  return DEFAULT_APPEARANCE_ID;
}

function AppearanceGlyph({ appearance }: { appearance: AppearanceDefinition }) {
  return (
    <span
      className="appearance-option-swatch"
      data-appearance={appearance.id}
      style={{ background: appearance.previewGradient }}
      aria-hidden="true"
    />
  );
}

export function AppearanceTileStrip({
  className = "",
  label = "Appearance",
}: {
  className?: string;
  label?: string;
}) {
  const appearanceId = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getServerAppearanceSnapshot,
  );

  return (
    <div
      className={`appearance-tile-strip ${className}`.trim()}
      role="radiogroup"
      aria-label={label}
    >
      {APPEARANCE_DEFINITIONS.map((appearance) => (
        <button
          className="appearance-tile"
          key={appearance.id}
          type="button"
          role="radio"
          aria-checked={appearance.id === appearanceId}
          aria-label={appearance.name}
          title={appearance.name}
          onClick={() => applyAppearance(appearance.id)}
        >
          <AppearanceGlyph appearance={appearance} />
        </button>
      ))}
    </div>
  );
}

export function AppearanceMenuSections({
  open,
  onRequestClose,
}: {
  open: boolean;
  onRequestClose: () => void;
}) {
  const committedAppearanceRef = useRef<AppearanceId>(DEFAULT_APPEARANCE_ID);
  const previewAppearanceRef = useRef<AppearanceId | null>(null);
  const appearanceId = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getServerAppearanceSnapshot,
  );
  const appearance = getAppearanceDefinition(appearanceId);
  const [interfaceZoom, setInterfaceZoom] = useInterfaceZoom();
  const interfaceZoomLabel = formatInterfaceZoom(interfaceZoom);
  const interfaceZoomDefaultStop =
    ((INTERFACE_ZOOM_DEFAULT - INTERFACE_ZOOM_MIN) /
      (INTERFACE_ZOOM_MAX - INTERFACE_ZOOM_MIN)) *
    100;

  useEffect(() => {
    committedAppearanceRef.current = appearanceId;
  }, [appearanceId]);

  const revertAppearancePreview = useCallback(() => {
    if (previewAppearanceRef.current === null) return;
    previewAppearanceRef.current = null;
    transitionAppearance(committedAppearanceRef.current);
  }, []);

  const previewAppearance = useCallback(
    (next: AppearanceId) => {
      if (next === committedAppearanceRef.current) {
        revertAppearancePreview();
        return;
      }
      if (previewAppearanceRef.current === next) return;
      previewAppearanceRef.current = next;
      transitionAppearance(next);
    },
    [revertAppearancePreview],
  );

  useEffect(() => {
    if (!open) revertAppearancePreview();
  }, [open, revertAppearancePreview]);

  useEffect(() => () => revertAppearancePreview(), [revertAppearancePreview]);

  function chooseAppearance(next: AppearanceId) {
    previewAppearanceRef.current = null;
    applyAppearance(next);
    onRequestClose();
  }

  return (
    <>
      <section
        className="account-menu-section appearance-menu-section"
        aria-labelledby="appearance-theme-heading"
        onMouseLeave={revertAppearancePreview}
        onBlurCapture={(event) => {
          if (
            !event.relatedTarget ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            revertAppearancePreview();
          }
        }}
      >
        <p id="appearance-theme-heading">Appearance</p>
        <div
          className="appearance-theme-options"
          role="radiogroup"
          aria-label="Appearance theme"
        >
          {APPEARANCE_DEFINITIONS.map((item) => {
            const selected = item.id === appearance.id;
            return (
              <button
                className="appearance-option"
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={item.name}
                onMouseEnter={() => previewAppearance(item.id)}
                onFocus={() => previewAppearance(item.id)}
                onClick={() => chooseAppearance(item.id)}
              >
                <span className="appearance-option-icons" aria-hidden="true">
                  <AppearanceGlyph appearance={item} />
                </span>
                <span
                  className="appearance-option-name"
                  style={{ fontFamily: item.previewDisplayFont }}
                >
                  {item.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section
        className="account-menu-section interface-zoom-section"
        aria-labelledby="interface-zoom-heading"
      >
        <div className="interface-zoom-heading-row">
          <p id="interface-zoom-heading">Interface zoom</p>
          <output
            className="interface-zoom-value"
            htmlFor="interface-zoom-slider"
          >
            {interfaceZoomLabel}
          </output>
        </div>
        <div
          className="interface-zoom-control"
          data-interface-zoom-control="true"
          style={{
            ["--interface-zoom-default-stop" as string]: `${interfaceZoomDefaultStop}%`,
          }}
        >
          <span
            className="interface-zoom-icon interface-zoom-icon-small"
            aria-hidden="true"
          >
            A
          </span>
          <input
            id="interface-zoom-slider"
            className="interface-zoom-slider"
            type="range"
            min={INTERFACE_ZOOM_MIN}
            max={INTERFACE_ZOOM_MAX}
            step={INTERFACE_ZOOM_STEP}
            value={interfaceZoom}
            onChange={(event) => setInterfaceZoom(Number(event.target.value))}
            aria-label="Interface zoom"
            aria-valuetext={interfaceZoomLabel}
          />
          <span
            className="interface-zoom-icon interface-zoom-icon-large"
            aria-hidden="true"
          >
            A
          </span>
        </div>
      </section>
    </>
  );
}
