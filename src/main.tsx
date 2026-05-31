import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import Overlay from "./Overlay";
import "./styles/index.css";

// Tauri ships two webviews — the main DictateAI UI and the small
// `overlay` window (the same NSPanel-backed pill that used to host
// "Listening…"; now used for the "Add 'X' to vocabulary?" prompt).
// Both share index.html; we branch here so each window renders the
// right React tree and gets the right body class for CSS targeting.
const label = getCurrentWebviewWindow().label;
document.body.classList.add(label === "overlay" ? "overlay-window" : "main-window");

// DIAGNOSTIC: ping the Rust side as soon as main.tsx runs. If we see
// `frontend_ping: label=overlay` in the Rust log at app launch, we
// know the overlay webview is loading + main.tsx is running. If we
// don't see it, the WKWebView never attached and we have a deeper
// Tauri problem.
void invoke("frontend_ping", { label }).catch(() => undefined);

try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>{label === "overlay" ? <Overlay /> : <App />}</StrictMode>,
  );
  void invoke("frontend_ping", { label: `${label}:render-ok` }).catch(
    () => undefined,
  );
} catch (err) {
  void invoke("frontend_ping", {
    label: `${label}:render-error:${err instanceof Error ? err.message : String(err)}`,
  }).catch(() => undefined);
  throw err;
}
