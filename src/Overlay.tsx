import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AudioLines, PenLine } from "lucide-react";
import { getAppState, getSetting } from "./lib/commands";

type OverlayState = "listening" | "processing";
type AppStatus = "idle" | "recording" | "processing";

export default function Overlay() {
  const [state, setState] = useState<OverlayState>("listening");
  const [appLanguage, setAppLanguage] = useState("en");

  useEffect(() => {
    const unlistenState = listen<string>("overlay-state", (event) => {
      setState(event.payload === "listening" ? "listening" : "processing");
    });
    const unlistenAppState = listen<string>("state-changed", (event) => {
      const appState = event.payload as AppStatus;
      if (appState === "recording") {
        setState("listening");
      } else if (appState === "processing") {
        setState("processing");
      }
    });

    let cancelled = false;
    const syncFromBackend = async () => {
      try {
        const appState = (await getAppState()) as AppStatus;
        if (cancelled) return;
        if (appState === "processing") {
          setState("processing");
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
  const listeningText = getOverlayText(appLanguage, "listening");
  const processingText = getOverlayText(appLanguage, "processing");

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent select-none">
      <div className="pointer-events-none flex items-center gap-3 rounded-full bg-[#050505]/95 px-5 py-3">
        <div>
          {isListening ? (
            <AudioLines className="overlay-audio-lines h-4 w-4 text-blue-500" />
          ) : (
            <PenLine className="overlay-rewrite-pen h-4 w-4 text-blue-500" />
          )}
        </div>
        <div className="grid">
          <span
            className={`col-start-1 row-start-1 text-sm font-medium text-white ${
              isListening ? "visible" : "invisible"
            }`}
          >
            {listeningText}
          </span>
          <span
            className={`col-start-1 row-start-1 text-sm font-medium text-white ${
              isListening ? "invisible" : "visible"
            }`}
          >
            {processingText}
          </span>
        </div>
      </div>
    </div>
  );
}

function getOverlayText(language: string, state: OverlayState): string {
  const text = {
    en: { listening: "Listening...", processing: "Rewriting..." },
    es: { listening: "Escuchando...", processing: "Reescribiendo..." },
    fr: { listening: "Ecoute...", processing: "Reecriture..." },
    de: { listening: "Hoere zu...", processing: "Schreibe um..." },
    ja: { listening: "聞き取り中...", processing: "書き換え中..." },
    zh: { listening: "正在听取...", processing: "正在改写..." },
    sv: { listening: "Lyssnar...", processing: "Skriver om..." },
    fi: { listening: "Kuunnellaan...", processing: "Muokataan..." },
  } as const;

  const lang = language as keyof typeof text;
  return (text[lang] ?? text.en)[state];
}
