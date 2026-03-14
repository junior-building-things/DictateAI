import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { startManualRecording, stopManualRecording } from "./commands";
import { useAppStore } from "./store";
import { getMicrophonePermissionState, type MicrophonePermissionState } from "./ui";

export type DictationStatus = "idle" | "listening" | "rewriting";

export interface DictationResult {
  original: string;
  rewritten: string;
}

interface DictationContextValue {
  status: DictationStatus;
  lastResult: DictationResult | null;
  liveTranscript: string;
  microphonePermission: MicrophonePermissionState;
  startDictation: () => Promise<void>;
  stopDictation: () => Promise<void>;
  setLastResult: React.Dispatch<React.SetStateAction<DictationResult | null>>;
}

const DictationContext = createContext<DictationContextValue | null>(null);

export function DictationProvider({ children }: { children: React.ReactNode }) {
  const value = useDictation();
  return React.createElement(DictationContext.Provider, { value }, children);
}

export function useDictationContext() {
  const context = useContext(DictationContext);
  if (!context) {
    throw new Error("useDictationContext must be used within DictationProvider");
  }

  return context;
}

function useDictation() {
  const { hotkeySettings, refreshHistory } = useAppStore();
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [lastResult, setLastResult] = useState<DictationResult | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermissionState>("unknown");

  const refreshMicrophonePermission = useCallback(async () => {
    const permission = await getMicrophonePermissionState();
    setMicrophonePermission(permission);
  }, []);

  useEffect(() => {
    void refreshMicrophonePermission();
  }, [refreshMicrophonePermission]);

  useEffect(() => {
    let currentOriginal = "";

    const subscriptions = Promise.all([
      listen<string>("state-changed", (event) => {
        if (event.payload === "recording") {
          setStatus("listening");
          return;
        }

        if (event.payload === "processing") {
          setStatus("rewriting");
          return;
        }

        setStatus("idle");
      }),
      listen<string>("transcription-complete", (event) => {
        currentOriginal = event.payload;
        setLiveTranscript(event.payload);
        setLastResult((previous) => ({
          original: event.payload,
          rewritten: previous?.rewritten ?? "",
        }));
      }),
      listen<string>("pipeline-complete", (event) => {
        setLastResult({
          original: currentOriginal,
          rewritten: event.payload,
        });
        setLiveTranscript("");
        toast.info(hotkeySettings.autoPaste ? "Pasted into active field." : "Copied to clipboard.");
        void refreshHistory();
      }),
      listen<string>("pipeline-error", (event) => {
        setLiveTranscript("");
        toast.error(event.payload);
      }),
      listen<string>("rewrite-error", (event) => {
        toast.error(event.payload);
      }),
      listen<string>("paste-error", (event) => {
        toast.error(event.payload);
      }),
    ]);

    return () => {
      void subscriptions.then((unsubscribers) => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      });
    };
  }, [hotkeySettings.autoPaste, refreshHistory]);

  const ensureMicrophonePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      await refreshMicrophonePermission();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophonePermission("granted");
    } catch {
      await refreshMicrophonePermission();
    }
  }, [refreshMicrophonePermission]);

  const startDictation = useCallback(async () => {
    if (status !== "idle") {
      return;
    }

    setLastResult(null);
    setLiveTranscript("");
    try {
      await ensureMicrophonePermission();
      await startManualRecording();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start dictation.");
    }
  }, [ensureMicrophonePermission, status]);

  const stopDictation = useCallback(async () => {
    if (status !== "listening") {
      return;
    }

    try {
      await stopManualRecording();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to stop dictation.");
    }
  }, [status]);

  return {
    status,
    lastResult,
    liveTranscript,
    microphonePermission,
    startDictation,
    stopDictation,
    setLastResult,
  };
}
