import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getAppState, getSetting } from "./lib/commands";

type OverlayState = "listening" | "rewriting";
type AppStatus = "idle" | "recording" | "processing";

export default function Overlay() {
  const [state, setState] = useState<OverlayState>("listening");
  const [appLanguage, setAppLanguage] = useState("en");

  useEffect(() => {
    const unlistenState = listen<string>("overlay-state", (event) => {
      setState(event.payload as OverlayState);
    });
    const unlistenAppState = listen<string>("state-changed", (event) => {
      const appState = event.payload as AppStatus;
      if (appState === "recording") {
        setState("listening");
      } else if (appState === "processing") {
        setState("rewriting");
      }
    });

    let cancelled = false;
    const syncFromBackend = async () => {
      try {
        const appState = (await getAppState()) as AppStatus;
        if (cancelled) return;
        if (appState === "processing") {
          setState("rewriting");
        } else if (appState === "recording") {
          setState("listening");
        }
      } catch {
        // Ignore transient polling errors
      }

      try {
        const language = await getSetting("interface_language");
        if (!cancelled) setAppLanguage(language);
      } catch {
        // Ignore transient polling errors
      }
    };

    void syncFromBackend();
    const interval = window.setInterval(() => {
      void syncFromBackend();
    }, 120);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unlistenState.then((fn) => fn());
      unlistenAppState.then((fn) => fn());
    };
  }, []);

  const isListening = state === "listening";
  const overlayText = getOverlayText(appLanguage, isListening ? "listening" : "rewriting");

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        userSelect: "none",
        WebkitUserSelect: "none",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 20px",
            borderRadius: "24px",
            background: "rgba(0, 0, 0, 0.9)",
            boxShadow:
              "-16px 0 22px -20px rgba(255, 255, 255, 0.22), 16px 0 22px -20px rgba(255, 255, 255, 0.22)",
            pointerEvents: "auto",
          }}
        >
          {/* Animated dot */}
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: isListening ? "#ef4444" : "#00A2C9",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          <span
            style={{
              color: "rgba(255, 255, 255, 0.9)",
              fontSize: "14px",
              fontWeight: 500,
              fontFamily:
                '"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
              letterSpacing: "-0.01em",
            }}
          >
            {overlayText}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}

function getOverlayText(language: string, state: "listening" | "rewriting"): string {
  const text = {
    en: { listening: "Listening...", rewriting: "Rewriting..." },
    es: { listening: "Escuchando...", rewriting: "Reescribiendo..." },
    fr: { listening: "Ecoute...", rewriting: "Reecriture..." },
    de: { listening: "Hoere zu...", rewriting: "Umschreiben..." },
    ja: { listening: "聞き取り中...", rewriting: "書き換え中..." },
    zh: { listening: "正在听取...", rewriting: "正在改写..." },
    sv: { listening: "Lyssnar...", rewriting: "Skriver om..." },
    fi: { listening: "Kuunnellaan...", rewriting: "Muokataan..." },
  } as const;

  const lang = language as keyof typeof text;
  return (text[lang] ?? text.en)[state];
}
