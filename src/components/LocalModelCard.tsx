import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteLocalModel,
  downloadLocalModel,
  localModelStatus,
} from "../lib/commands";
import { useI18n } from "../lib/i18n";

interface LocalModelProgress {
  id: string;
  phase: "downloading" | "extracting" | "ready" | string;
  bytes_done: number;
  bytes_total: number | null;
}

export interface LocalModelCardProps {
  modelId: string;
  approxSizeMb?: number;
}

/**
 * Compact action area for a local model — renders just the action button
 * (Download or Remove) plus a slim progress bar while installing. Lives
 * inside an `.s-row` `.s-control` slot so its vertical baseline matches
 * the API-key rows in the Models tab. No card chrome, no duplicate title.
 */
export default function LocalModelCard({ modelId }: LocalModelCardProps) {
  const { t } = useI18n();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<LocalModelProgress["phase"] | null>(null);
  const [bytesDone, setBytesDone] = useState(0);
  const [bytesTotal, setBytesTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await localModelStatus(modelId);
        if (cancelled) return;
        setInstalled(status.installed);
      } catch {
        if (!cancelled) setInstalled(false);
      }
    };
    void refresh();

    const unlisten = listen<LocalModelProgress>("local-model-progress", (event) => {
      if (event.payload.id !== modelId) return;
      setPhase(event.payload.phase);
      setBytesDone(event.payload.bytes_done);
      setBytesTotal(event.payload.bytes_total);
      if (event.payload.phase === "ready") {
        void refresh();
      }
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, [modelId]);

  const handleInstall = async () => {
    setBusy(true);
    setPhase("downloading");
    setBytesDone(0);
    setBytesTotal(null);
    try {
      await downloadLocalModel(modelId);
      // Don't trust the progress event alone — re-fetch the on-disk status
      // so the button reliably flips Download → Remove.
      const status = await localModelStatus(modelId).catch(() => null);
      setInstalled(status?.installed ?? true);
      setPhase(null);
      toast.success(t("installedToast"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setPhase(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteLocalModel(modelId);
      setInstalled(false);
      setPhase(null);
      toast.success(t("deletedToast"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const percent =
    bytesTotal && bytesTotal > 0
      ? Math.min(100, Math.round((bytesDone / bytesTotal) * 100))
      : null;

  // Single inline action — matches the design's renderKeyRow(local) shape.
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="field-row">
        {busy && phase === "downloading" ? (
          <button type="button" className="btn" disabled>
            <Loader2 strokeWidth={2} className="animate-spin" />
            {percent !== null ? t("downloadingPercent", { percent }) : t("downloadingLabel")}
          </button>
        ) : installed ? (
          <button type="button" className="btn" onClick={() => void handleDelete()} disabled={busy}>
            <Trash2 strokeWidth={2} />
            {t("removeBtnLabel")}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ai"
            onClick={() => void handleInstall()}
            disabled={busy}
          >
            <Download strokeWidth={2} />
            {t("downloadBtnLabel")}
          </button>
        )}
      </div>

      {busy && phase === "downloading" && percent !== null ? (
        <div
          className="h-1 w-full overflow-hidden rounded-full"
          style={{ background: "var(--bg-elev-3)" }}
        >
          <div
            className="h-full transition-[width] duration-150"
            style={{
              width: `${percent}%`,
              background: "var(--ai)",
              boxShadow: "0 0 8px var(--ai-glow)",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
