import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { installTauriApi } from "./tauri-api";

/* Local font imports — bundled into the app, no internet needed */
import "@fontsource/ibm-plex-sans/300.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "material-symbols/outlined.css";

import "./styles.css";

/**
 * Install the Tauri-backed DesktopApi onto `window.qaBuddy` before mounting
 * React, so every `window.qaBuddy.*` call in the renderer resolves to a Tauri
 * command. The promise is awaited to guarantee ordering.
 */
installTauriApi().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
});
