import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import {
  BrowserRuntime,
  readBrowserRuntimeConfig,
  RuntimeState,
} from "./runtime.js";
import "./styles.css";

let content;
try {
  const config = readBrowserRuntimeConfig();
  content = (
    <BrowserRuntime config={config}>
      <App />
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>{content}</StrictMode>,
);
