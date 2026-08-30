import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthenticApp } from "./AuthenticApp.js";
import {
  getAppearanceAttributes,
  resolveAppearanceId,
  APPEARANCE_STORAGE_KEY,
} from "./design-system/theme-registry.js";
import {
  applyInterfaceZoomToDocument,
  getInterfaceZoom,
} from "./design-system/interface-zoom-client.js";
import {
  BrowserRuntime,
  readBrowserRuntimeConfig,
  RuntimeState,
} from "./runtime.js";
import "./authentic.css";
import "./interface-foundation.css";

const appearance = getAppearanceAttributes(
  resolveAppearanceId(localStorage.getItem(APPEARANCE_STORAGE_KEY)),
);
document.documentElement.dataset.theme = appearance.theme;
document.documentElement.dataset.surface = appearance.surface;
document.documentElement.dataset.mode = appearance.mode;
applyInterfaceZoomToDocument(getInterfaceZoom());

async function mount() {
  let content;
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("preview")
  ) {
    const { PreviewRuntime } = await import("./preview-runtime.js");
    content = (
      <PreviewRuntime>
        <AuthenticApp />
      </PreviewRuntime>
    );
  } else {
    try {
      const config = readBrowserRuntimeConfig();
      content = (
        <BrowserRuntime config={config}>
          <AuthenticApp />
        </BrowserRuntime>
      );
    } catch (error) {
      content = (
        <RuntimeState
          title="Runtime configuration failed"
          detail={
            error instanceof Error
              ? error.message
              : "Browser runtime configuration is invalid."
          }
        />
      );
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>{content}</StrictMode>,
  );
}

void mount();
