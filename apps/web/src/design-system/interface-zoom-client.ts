"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  INTERFACE_ZOOM_DEFAULT,
  INTERFACE_ZOOM_STORAGE_KEY,
  normalizeInterfaceZoom,
} from "./interface-zoom.js";

const INTERFACE_ZOOM_CHANGE_EVENT = "vorton-interface-zoom-change";

export function getInterfaceZoom(): number {
  if (typeof window === "undefined") return INTERFACE_ZOOM_DEFAULT;

  try {
    return normalizeInterfaceZoom(
      window.localStorage.getItem(INTERFACE_ZOOM_STORAGE_KEY),
    );
  } catch {
    return INTERFACE_ZOOM_DEFAULT;
  }
}

export function applyInterfaceZoomToDocument(
  nextZoom = getInterfaceZoom(),
): void {
  if (typeof document === "undefined") return;

  const zoom = normalizeInterfaceZoom(nextZoom);
  document.documentElement.dataset.interfaceZoom = String(zoom);
}

export function setInterfaceZoom(nextZoom: number): void {
  if (typeof window === "undefined") return;

  const zoom = normalizeInterfaceZoom(nextZoom);
  try {
    window.localStorage.setItem(INTERFACE_ZOOM_STORAGE_KEY, String(zoom));
  } catch {
    return;
  }
  applyInterfaceZoomToDocument(zoom);
  window.dispatchEvent(
    new CustomEvent(INTERFACE_ZOOM_CHANGE_EVENT, { detail: zoom }),
  );
}

function subscribeInterfaceZoom(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === INTERFACE_ZOOM_STORAGE_KEY) onChange();
  };
  window.addEventListener(INTERFACE_ZOOM_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(INTERFACE_ZOOM_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useInterfaceZoom(): [number, (nextZoom: number) => void] {
  const zoom = useSyncExternalStore(
    subscribeInterfaceZoom,
    getInterfaceZoom,
    () => INTERFACE_ZOOM_DEFAULT,
  );

  useEffect(() => {
    applyInterfaceZoomToDocument(getInterfaceZoom());
  }, []);

  return [zoom, setInterfaceZoom];
}
