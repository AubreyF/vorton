export const INTERFACE_ZOOM_MIN = 75;
export const INTERFACE_ZOOM_MAX = 200;
export const INTERFACE_ZOOM_STEP = 5;
export const INTERFACE_ZOOM_DEFAULT = 100;
export const INTERFACE_ZOOM_STORAGE_KEY = "vorton-interface-zoom";

export function normalizeInterfaceZoom(value: number | string | null): number {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return INTERFACE_ZOOM_DEFAULT;

  const rounded =
    Math.round(parsed / INTERFACE_ZOOM_STEP) * INTERFACE_ZOOM_STEP;
  return Math.min(INTERFACE_ZOOM_MAX, Math.max(INTERFACE_ZOOM_MIN, rounded));
}

export function formatInterfaceZoom(value: number): string {
  return `${normalizeInterfaceZoom(value).toLocaleString()}%`;
}

export function getInterfaceZoomBootstrapScript(): string {
  return `
(function () {
  var minimum = ${INTERFACE_ZOOM_MIN};
  var maximum = ${INTERFACE_ZOOM_MAX};
  var step = ${INTERFACE_ZOOM_STEP};
  var fallback = ${INTERFACE_ZOOM_DEFAULT};
  var parsed = fallback;
  try {
    parsed = Number.parseFloat(localStorage.getItem(${JSON.stringify(INTERFACE_ZOOM_STORAGE_KEY)}) || "");
  } catch (error) {
    parsed = fallback;
  }
  if (!Number.isFinite(parsed)) parsed = fallback;
  var zoom = Math.min(maximum, Math.max(minimum, Math.round(parsed / step) * step));
  document.documentElement.setAttribute("data-interface-zoom", String(zoom));
})();
`;
}
