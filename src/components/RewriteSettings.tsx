import { useEffect, useState } from "react";

import ApiKeySettings from "./ApiKeySettings";
import PromptSettings from "./PromptSettings";
import {
  downloadOnDeviceModels,
  isOnDeviceSupported,
  getOnDeviceStatus,
  getSetting,
  removeOnDeviceModels,
  saveSetting,
} from "../lib/commands";
import type { OnDeviceStatus } from "../lib/types";
import { useI18n } from "../lib/i18n";

type ModelMode = "api" | "on-device";

export default function RewriteSettings() {
  const { language } = useI18n();
  const copy = getSetupCopy(language);
  const [mode, setMode] = useState<ModelMode>("api");
  const [status, setStatus] = useState<OnDeviceStatus | null>(null);
  const [onDeviceSupported, setOnDeviceSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    const load = async () => {
      const [storedMode, onDeviceStatus, supportsOnDevice] = await Promise.all([
        getSetting("model_mode").catch(() => "api"),
        getOnDeviceStatus().catch(() => null),
        isOnDeviceSupported().catch(() => true),
      ]);

      const nextMode =
        supportsOnDevice && storedMode === "on-device" ? "on-device" : "api";

      setMode(nextMode);
      setStatus(onDeviceStatus);
      setOnDeviceSupported(supportsOnDevice);
      setLoading(false);

      if (!supportsOnDevice && storedMode === "on-device") {
        await saveSetting("model_mode", "api").catch(() => undefined);
      }
    };

    void load();
  }, []);

  const selectMode = async (nextMode: ModelMode) => {
    setMode(nextMode);
    await saveSetting("model_mode", nextMode);
  };

  const handleDownload = async () => {
    setIsWorking(true);
    setDownloadError("");
    try {
      const nextStatus = await downloadOnDeviceModels();
      setStatus(nextStatus);
    } catch (error) {
      setDownloadError(normalizeError(error, copy.downloadFailed));
    } finally {
      setIsWorking(false);
    }
  };

  const handleRemove = async () => {
    setIsWorking(true);
    setDownloadError("");
    try {
      const nextStatus = await removeOnDeviceModels();
      setStatus(nextStatus);
    } catch (error) {
      setDownloadError(normalizeError(error, copy.removeFailed));
    } finally {
      setIsWorking(false);
    }
  };

  if (loading) {
    return <div className="p-7 text-sm text-neutral-500">{copy.loading}</div>;
  }

  return (
    <section className="space-y-6 p-7">
      <section className="surface-card space-y-5 p-6">
        <div className="space-y-2">
          <h3 className="section-title">{copy.title}</h3>
          <p className="field-help">{copy.subtitle}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={optionClass(mode === "api")}>
            <input
              type="radio"
              name="model-mode"
              checked={mode === "api"}
              onChange={() => void selectMode("api")}
              className="sr-only"
            />
            <span className={radioIndicatorClass(mode === "api")} aria-hidden="true">
              <span className={radioDotClass(mode === "api")} />
            </span>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-white">{copy.apiTitle}</div>
              <div className="text-xs text-neutral-400">{copy.apiSpeech}</div>
              <div className="text-xs text-neutral-400">{copy.apiRewrite}</div>
              <div className="text-xs text-neutral-400">{copy.apiLatency}</div>
            </div>
          </label>

          <div className={optionClass(mode === "on-device", !onDeviceSupported)}>
            {onDeviceSupported ? (
              <input
                type="radio"
                name="model-mode"
                checked={mode === "on-device"}
                onChange={() => void selectMode("on-device")}
                className="sr-only"
              />
            ) : null}
            <span
              className={radioIndicatorClass(mode === "on-device", !onDeviceSupported)}
              aria-hidden="true"
            >
              <span className={radioDotClass(mode === "on-device")} />
            </span>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-white">{copy.onDeviceTitle}</div>
              {onDeviceSupported ? (
                <>
                  <div className="text-xs text-neutral-400">{copy.onDeviceSpeech}</div>
                  <div className="text-xs text-neutral-400">{copy.onDeviceRewrite}</div>
                  <div className="text-xs text-neutral-400">{copy.onDeviceLatency}</div>
                </>
              ) : (
                <div className="text-xs font-medium text-neutral-500">
                  {copy.onDeviceComingSoon}
                </div>
              )}
            </div>
          </div>
        </div>

        {mode === "on-device" && onDeviceSupported ? (
          <section className="pt-1">
            <div className="space-y-2">
              {!status?.modelsDownloaded && (
                <p className="field-help">{copy.onDeviceModelsHelp}</p>
              )}
              {status?.modelsDownloaded && (
                <p className="field-help">{copy.modelsDownloaded}</p>
              )}
              {downloadError && (
                <p className="text-xs text-red-300">{downloadError}</p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  void (status?.modelsDownloaded ? handleRemove() : handleDownload())
                }
                disabled={isWorking}
                className={
                  status?.modelsDownloaded
                    ? "btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                    : "btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                }
              >
                {isWorking
                  ? status?.modelsDownloaded
                    ? copy.removing
                    : copy.downloading
                  : status?.modelsDownloaded
                    ? copy.removeModels
                    : copy.downloadModels}
              </button>
            </div>
          </section>
        ) : null}
      </section>

      {mode === "api" && <ApiKeySettings />}
      <PromptSettings />
    </section>
  );
}

function optionClass(selected: boolean, disabled = false) {
  return [
    "flex items-start gap-3 rounded-2xl border p-4 transition overflow-visible",
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
    selected
      ? "border-neutral-500 bg-neutral-900 text-white"
      : disabled
        ? "border-neutral-800 bg-neutral-950/50 text-neutral-300"
        : "border-neutral-800 bg-neutral-950/50 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-900/80",
  ].join(" ");
}

function radioIndicatorClass(selected: boolean, disabled = false) {
  return [
    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
    selected
      ? "border-white bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
      : disabled
        ? "border-neutral-700 bg-transparent"
        : "border-neutral-500 bg-transparent",
  ].join(" ");
}

function radioDotClass(selected: boolean) {
  return [
    "h-2.5 w-2.5 rounded-full transition",
    selected ? "bg-white" : "bg-transparent",
  ].join(" ");
}

function getSetupCopy(language: string) {
  const copy = {
    en: {
      loading: "Loading...",
      title: "Model Selection",
      subtitle: "Choose between APIs and on-device models.",
      apiTitle: "API (Recommended)",
      apiSpeech: "Speech model: gpt-4o-mini-transcribe",
      apiRewrite: "Rewriting model: gemini-2.5-flash-lite",
      apiLatency: "E2E latency: ~2.9s",
      onDeviceTitle: "On-Device",
      onDeviceComingSoon: "Coming soon",
      onDeviceSpeech: "Speech model: whisper.cpp base",
      onDeviceRewrite: "Rewriting model: TinyLlama 1.1B",
      onDeviceLatency: "E2E latency: ~4.1s",
      onDeviceModelsHelp:
        "Download the models to enable on-device processing. This may take up to a minute.",
      downloadModels: "Download On-Device Models",
      modelsDownloaded: "On-device models have been downloaded.",
      removeModels: "Remove On-Device Models",
      downloading: "Downloading Models...",
      removing: "Removing Models...",
      downloadFailed: "Failed to download on-device models.",
      removeFailed: "Failed to remove on-device models.",
    },
    sv: {
      loading: "Laddar...",
      title: "Modellval",
      subtitle: "Välj mellan API:er och modeller på enheten.",
      apiTitle: "API (Rekommenderat)",
      apiSpeech: "Talmodell: gpt-4o-mini-transcribe",
      apiRewrite: "Omskrivningsmodell: gemini-2.5-flash-lite",
      apiLatency: "E2E-latens: ~2.9s",
      onDeviceTitle: "På Enheten",
      onDeviceComingSoon: "Kommer snart",
      onDeviceSpeech: "Talmodell: whisper.cpp base",
      onDeviceRewrite: "Omskrivningsmodell: TinyLlama 1.1B",
      onDeviceLatency: "E2E-latens: ~4.1s",
      onDeviceModelsHelp:
        "Ladda ner modellerna för att aktivera bearbetning på enheten. Det kan ta upp till en minut.",
      downloadModels: "Ladda Ner Modeller På Enheten",
      modelsDownloaded: "Modeller på enheten har laddats ner.",
      removeModels: "Ta Bort Modeller På Enheten",
      downloading: "Laddar ner modeller...",
      removing: "Tar bort modeller...",
      downloadFailed: "Det gick inte att ladda ner de lokala modellerna.",
      removeFailed: "Det gick inte att ta bort de lokala modellerna.",
    },
    fi: {
      loading: "Ladataan...",
      title: "Mallin valinta",
      subtitle: "Valitse API:en ja laitteella olevien mallien välillä.",
      apiTitle: "API (Suositeltu)",
      apiSpeech: "Puhemalli: gpt-4o-mini-transcribe",
      apiRewrite: "Uudelleenkirjoitusmalli: gemini-2.5-flash-lite",
      apiLatency: "E2E-viive: ~2.9s",
      onDeviceTitle: "Laitteessa",
      onDeviceComingSoon: "Tulossa pian",
      onDeviceSpeech: "Puhemalli: whisper.cpp base",
      onDeviceRewrite: "Uudelleenkirjoitusmalli: TinyLlama 1.1B",
      onDeviceLatency: "E2E-viive: ~4.1s",
      onDeviceModelsHelp:
        "Lataa mallit ottaaksesi laitteella tapahtuvan käsittelyn käyttöön. Tämä voi kestää enintään minuutin.",
      downloadModels: "Lataa Laitemallit",
      modelsDownloaded: "Laitemallit on ladattu.",
      removeModels: "Poista Laitemallit",
      downloading: "Ladataan malleja...",
      removing: "Poistetaan malleja...",
      downloadFailed: "Paikallisten mallien lataus epaonnistui.",
      removeFailed: "Paikallisten mallien poistaminen epaonnistui.",
    },
    es: {
      loading: "Cargando...",
      title: "Selección de Modelo",
      subtitle: "Elige entre API y modelos en el dispositivo.",
      apiTitle: "API (Recomendado)",
      apiSpeech: "Modelo de Voz: gpt-4o-mini-transcribe",
      apiRewrite: "Modelo de Reescritura: gemini-2.5-flash-lite",
      apiLatency: "Latencia E2E: ~2.9s",
      onDeviceTitle: "En el Dispositivo",
      onDeviceComingSoon: "Proximamente",
      onDeviceSpeech: "Modelo de Voz: whisper.cpp base",
      onDeviceRewrite: "Modelo de Reescritura: TinyLlama 1.1B",
      onDeviceLatency: "Latencia E2E: ~4.1s",
      onDeviceModelsHelp:
        "Descarga los modelos para habilitar el procesamiento en el dispositivo. Esto puede tardar hasta un minuto.",
      downloadModels: "Descargar Modelos en el Dispositivo",
      modelsDownloaded: "Los modelos en el dispositivo se han descargado.",
      removeModels: "Eliminar Modelos en el Dispositivo",
      downloading: "Descargando modelos...",
      removing: "Eliminando modelos...",
      downloadFailed: "No se pudieron descargar los modelos en el dispositivo.",
      removeFailed: "No se pudieron eliminar los modelos en el dispositivo.",
    },
    fr: {
      loading: "Chargement...",
      title: "Sélection du Modèle",
      subtitle: "Choisissez entre des API et des modèles sur l'appareil.",
      apiTitle: "API (Recommandee)",
      apiSpeech: "Modèle Vocal : gpt-4o-mini-transcribe",
      apiRewrite: "Modèle de Réécriture : gemini-2.5-flash-lite",
      apiLatency: "Latence E2E : ~2.9s",
      onDeviceTitle: "Sur l'Appareil",
      onDeviceComingSoon: "Bientot disponible",
      onDeviceSpeech: "Modèle Vocal : whisper.cpp base",
      onDeviceRewrite: "Modèle de Réécriture : TinyLlama 1.1B",
      onDeviceLatency: "Latence E2E : ~4.1s",
      onDeviceModelsHelp:
        "Téléchargez les modèles pour activer le traitement sur l'appareil. Cela peut prendre jusqu'à une minute.",
      downloadModels: "Télécharger les Modèles sur l'Appareil",
      modelsDownloaded: "Les modèles sur l'appareil ont été téléchargés.",
      removeModels: "Supprimer les Modèles sur l'Appareil",
      downloading: "Téléchargement des modèles...",
      removing: "Suppression des modèles...",
      downloadFailed: "Échec du téléchargement des modèles sur l'appareil.",
      removeFailed: "Échec de la suppression des modèles sur l'appareil.",
    },
    de: {
      loading: "Laden...",
      title: "Modellauswahl",
      subtitle: "Wähle zwischen APIs und Modellen auf dem Gerät.",
      apiTitle: "API (Empfohlen)",
      apiSpeech: "Sprachmodell: gpt-4o-mini-transcribe",
      apiRewrite: "Umschreibmodell: gemini-2.5-flash-lite",
      apiLatency: "E2E-Latenz: ~2.9s",
      onDeviceTitle: "Auf dem Gerät",
      onDeviceComingSoon: "Demnächst",
      onDeviceSpeech: "Sprachmodell: whisper.cpp base",
      onDeviceRewrite: "Umschreibmodell: TinyLlama 1.1B",
      onDeviceLatency: "E2E-Latenz: ~4.1s",
      onDeviceModelsHelp:
        "Lade die Modelle herunter, um die Verarbeitung auf dem Gerät zu aktivieren. Das kann bis zu eine Minute dauern.",
      downloadModels: "Modelle auf dem Gerät Herunterladen",
      modelsDownloaded: "Die Modelle auf dem Gerät wurden heruntergeladen.",
      removeModels: "Modelle auf dem Gerät Entfernen",
      downloading: "Modelle werden heruntergeladen...",
      removing: "Modelle werden entfernt...",
      downloadFailed: "Die Modelle auf dem Gerät konnten nicht heruntergeladen werden.",
      removeFailed: "Die Modelle auf dem Gerät konnten nicht entfernt werden.",
    },
    ja: {
      loading: "読み込み中...",
      title: "モデル選択",
      subtitle: "API とデバイス上のモデルを選択できます。",
      apiTitle: "API（推奨）",
      apiSpeech: "音声モデル: gpt-4o-mini-transcribe",
      apiRewrite: "書き換えモデル: gemini-2.5-flash-lite",
      apiLatency: "E2Eレイテンシー: ~2.9s",
      onDeviceTitle: "オンデバイス",
      onDeviceComingSoon: "近日公開",
      onDeviceSpeech: "音声モデル: whisper.cpp base",
      onDeviceRewrite: "書き換えモデル: TinyLlama 1.1B",
      onDeviceLatency: "E2Eレイテンシー: ~4.1s",
      onDeviceModelsHelp:
        "オンデバイス処理を有効にするにはモデルをダウンロードしてください。最大1分ほどかかります。",
      downloadModels: "オンデバイスモデルをダウンロード",
      modelsDownloaded: "オンデバイスモデルのダウンロードが完了しました。",
      removeModels: "オンデバイスモデルを削除",
      downloading: "モデルをダウンロード中...",
      removing: "モデルを削除中...",
      downloadFailed: "オンデバイスモデルのダウンロードに失敗しました。",
      removeFailed: "オンデバイスモデルの削除に失敗しました。",
    },
    zh: {
      loading: "加载中...",
      title: "模型选择",
      subtitle: "可在 API 和设备端模型之间选择。",
      apiTitle: "API（推荐）",
      apiSpeech: "语音模型：gpt-4o-mini-transcribe",
      apiRewrite: "改写模型：gemini-2.5-flash-lite",
      apiLatency: "端到端延迟：~2.9s",
      onDeviceTitle: "本地设备",
      onDeviceComingSoon: "即将推出",
      onDeviceSpeech: "语音模型：whisper.cpp base",
      onDeviceRewrite: "改写模型：TinyLlama 1.1B",
      onDeviceLatency: "端到端延迟：~4.1s",
      onDeviceModelsHelp:
        "下载模型以启用本地处理。最多可能需要一分钟。",
      downloadModels: "下载本地模型",
      modelsDownloaded: "本地模型已下载。",
      removeModels: "移除本地模型",
      downloading: "正在下载模型...",
      removing: "正在移除模型...",
      downloadFailed: "下载本地模型失败。",
      removeFailed: "移除本地模型失败。",
    },
  } as const;

  return copy[language as keyof typeof copy] ?? copy.en;
}

function normalizeError(error: unknown, fallback: string) {
  void error;
  return fallback;
}
