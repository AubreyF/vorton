import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow-condensed/latin-300.css";
import "@fontsource/barlow-condensed/latin-400.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/geist/latin-600.css";
import "@fontsource/geist/latin-700.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "@fontsource/geist-mono/latin-600.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
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
    document.title = "Vorton Preview";
    const { PreviewRuntime } = await import("./preview-runtime.js");
    content = (
      <PreviewRuntime>
        <AuthenticApp />
      </PreviewRuntime>
    );
  } else {
    try {
      const config = readBrowserRuntimeConfig();
      document.title = config.installationName;
      document
        .querySelector('meta[name="description"]')
        ?.setAttribute(
          "content",
          `${config.installationName} governed control plane`,
        );
      content = (
        <BrowserRuntime config={config}>
          <AuthenticApp />
        </BrowserRuntime>
      );
    } catch (error) {
      content = (
        <RuntimeState
          installationName="Installation"
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
