import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteLocalModel,
  downloadLocalModel,
  localModelStatus,
} from "../lib/commands";

interface LocalModelProgress {
  id: string;
  phase: "downloading" | "extracting" | "ready" | string;
  bytes_done: number;
  bytes_total: number | null;
}

export interface LocalModelCardProps {
  modelId: string;
  title: string;
  subtitle?: string;
  approxSizeMb?: number;
  /// Extra UI rendered below the action row (e.g. the streaming toggle for
  /// the Parakeet card).
  extras?: React.ReactNode;
}

export default function LocalModelCard({
  modelId,
  title,
  subtitle,
  approxSizeMb,
  extras,
}: LocalModelCardProps) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<LocalModelProgress["phase"] | null>(null);
  const [bytesDone, setBytesDone] = useState(0);
  const [bytesTotal, setBytesTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [installedPath, setInstalledPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await localModelStatus(modelId);
        if (cancelled) return;
        setInstalled(status.installed);
        setInstalledPath(status.path);
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
      toast.success(`${title} installed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setPhase(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${title}? You'll need to re-download (~${approxSizeMb ?? "?"} MB) to use it again.`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteLocalModel(modelId);
      setInstalled(false);
      setInstalledPath(null);
      setPhase(null);
      toast.success(`${title} deleted`);
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

  return (
    <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {installed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Installed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-neutral-400">
                Not installed
              </span>
            )}
          </div>
          {subtitle ? (
            <p className="text-xs leading-5 text-neutral-400">{subtitle}</p>
          ) : null}
          {approxSizeMb ? (
            <p className="text-[11px] text-neutral-500">~{approxSizeMb} MB on disk</p>
          ) : null}
          {installedPath ? (
            <p className="break-all text-[10px] text-neutral-600">{installedPath}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {installed ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-neutral-300 transition hover:bg-white/[0.1] disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleInstall()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-500/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              <Download className="h-3 w-3" />
              {busy ? "Installing..." : "Install"}
            </button>
          )}
        </div>
      </div>

      {busy && phase && phase !== "ready" ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>
              {phase === "downloading" ? "Downloading" : phase === "extracting" ? "Extracting" : phase}
              {percent !== null ? ` — ${percent}%` : "..."}
            </span>
            {bytesTotal ? (
              <span>
                {fmtMB(bytesDone)} / {fmtMB(bytesTotal)}
              </span>
            ) : null}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full bg-blue-500 transition-[width] duration-150"
              style={{ width: percent !== null ? `${percent}%` : "30%" }}
            />
          </div>
        </div>
      ) : null}

      {extras}
    </div>
  );
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}
