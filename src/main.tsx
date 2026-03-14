import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import Overlay from "./Overlay";
import "./styles/index.css";

const label = getCurrentWebviewWindow().label;
document.body.classList.add(label === "overlay" ? "overlay-window" : "main-window");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{label === "overlay" ? <Overlay /> : <App />}</StrictMode>,
);
