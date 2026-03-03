import { useEffect, useState } from "react";
import {
  getAvailableModels,
  getSetting,
  saveSetting,
} from "../lib/commands";
import type { ModelInfo } from "../lib/types";
import { useI18n } from "../lib/i18n";

export default function TranscriptionSettings() {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState("gpt-4o-mini-transcribe");
  const [loading, setLoading] = useState(true);

  const [openaiKey, setOpenaiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [googleProject, setGoogleProject] = useState("");
  const [googleRegion, setGoogleRegion] = useState("us");
  const [doubaoToken, setDoubaoToken] = useState("");
  const [doubaoAppId, setDoubaoAppId] = useState("");
  const [doubaoCluster, setDoubaoCluster] = useState("byteplus_input");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [available, current, openai, google, project, region, doubao, doubaoApp, doubaoCls] = await Promise.all([
        getAvailableModels(),
        getSetting("speech_model").catch(() => "gpt-4o-mini-transcribe"),
        getSetting("speech_openai_api_key").catch(() => ""),
        getSetting("speech_google_api_key").catch(() => ""),
        getSetting("speech_google_project_id").catch(() => ""),
        getSetting("speech_google_region").catch(() => "us"),
        getSetting("speech_doubao_access_token").catch(() => ""),
        getSetting("speech_doubao_app_id").catch(() => ""),
        getSetting("speech_doubao_cluster").catch(() => "byteplus_input"),
      ]);

      setModels(available);
      const availableNames = new Set(available.map((m) => m.name));
      const selectedModel = availableNames.has(current) ? current : "gpt-4o-mini-transcribe";
      setSelected(selectedModel);
      if (selectedModel !== current) {
        await saveSetting("speech_model", selectedModel);
      }
      setOpenaiKey(openai);
      setGoogleKey(google);
      setGoogleProject(project);
      setGoogleRegion(region || "us");
      setDoubaoToken(doubao);
      setDoubaoAppId(doubaoApp);
      setDoubaoCluster(doubaoCls || "byteplus_input");
      setLoading(false);
    };

    void load();
  }, []);

  const handleSelect = async (name: string) => {
    setSelected(name);
    await saveSetting("speech_model", name);
  };

  const saveCredentials = async () => {
    await Promise.all([
      saveSetting("speech_openai_api_key", openaiKey.trim()),
      saveSetting("speech_google_api_key", googleKey.trim()),
      saveSetting("speech_google_project_id", googleProject.trim()),
      saveSetting("speech_google_region", googleRegion.trim() || "us"),
      saveSetting("speech_doubao_access_token", doubaoToken.trim()),
      saveSetting("speech_doubao_app_id", doubaoAppId.trim()),
      saveSetting("speech_doubao_cluster", doubaoCluster.trim() || "byteplus_input"),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (loading) return <div className="p-6 text-sm text-neutral-500">{t("loading")}</div>;

  return (
    <section className="space-y-4 p-6">
      <h3 className="text-base font-semibold text-neutral-100">Speech model</h3>

      <div className="space-y-2">
        {models.map((model) => {
          const isSelected = selected === model.name;
          return (
            <label
              key={model.name}
              className={`flex items-center gap-3 rounded-2xl border p-4 transition ${
                isSelected
                  ? "border-neutral-500 bg-neutral-800/75 text-white"
                  : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-700"
              }`}
            >
              <input
                type="radio"
                name="transcription-model"
                checked={isSelected}
                onChange={() => void handleSelect(model.name)}
                className="h-4 w-4 accent-neutral-200"
              />
              <div>
                <div className="text-sm font-semibold">{model.name}</div>
                <div className={`mt-1 text-xs ${isSelected ? "text-neutral-200" : "text-neutral-500"}`}>
                  {model.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <section className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
        <h3 className="text-base font-semibold text-neutral-100">Speech API credentials</h3>
        <p className="text-xs text-neutral-500">
          Configure the provider credentials for your selected speech model.
        </p>

        {(selected === "gpt-4o-mini-transcribe" || selected === "gpt-4o-transcribe") && (
          <>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">OpenAI API key</label>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
            />
          </>
        )}

        {selected === "google-chirp-3" && (
          <>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Google API key</label>
            <input
              type="password"
              value={googleKey}
              onChange={(e) => setGoogleKey(e.target.value)}
              placeholder="AIza..."
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
            />
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Google Project ID</label>
            <input
              value={googleProject}
              onChange={(e) => setGoogleProject(e.target.value)}
              placeholder="my-gcp-project"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
            />
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Google Region</label>
            <input
              value={googleRegion}
              onChange={(e) => setGoogleRegion(e.target.value)}
              placeholder="us"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
            />
          </>
        )}

        {selected === "doubao-byteplus" && (
          <>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Doubao/BytePlus app ID</label>
            <input
              value={doubaoAppId}
              onChange={(e) => setDoubaoAppId(e.target.value)}
              placeholder="app id"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
            />
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Doubao/BytePlus access token</label>
            <input
              type="password"
              value={doubaoToken}
              onChange={(e) => setDoubaoToken(e.target.value)}
              placeholder="access token"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
            />
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Doubao cluster</label>
            <input
              value={doubaoCluster}
              onChange={(e) => setDoubaoCluster(e.target.value)}
              placeholder="byteplus_input"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
            />
          </>
        )}

        <button
          onClick={() => void saveCredentials()}
          className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-neutral-100"
        >
          {saved ? t("saved") : t("save")}
        </button>
      </section>
    </section>
  );
}
