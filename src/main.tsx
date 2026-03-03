import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./styles/globals.css";
import App from "./App.tsx";
import Overlay from "./Overlay.tsx";
import { I18nProvider } from "./lib/i18n";

const label = getCurrentWebviewWindow().label;
document.body.classList.add(label === "overlay" ? "overlay-window" : "main-window");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {label === "overlay" ? (
      <Overlay />
    ) : (
      <I18nProvider>
        <App />
      </I18nProvider>
    )}
  </StrictMode>
);
