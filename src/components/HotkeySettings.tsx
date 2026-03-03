import { useEffect, useState } from "react";
import { getSetting, saveSetting } from "../lib/commands";

export default function HotkeySettings() {
  const [hotkey, setHotkey] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSetting("hotkey").then((key) => {
      setHotkey(key);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    await saveSetting("hotkey", hotkey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div className="text-sm text-neutral-500">Loading...</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-400">
        Set the global hotkey to trigger speech recording. Hold the hotkey to record, release to process.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={hotkey}
          onChange={(e) => setHotkey(e.target.value)}
          placeholder="e.g., CommandOrControl+S"
          className="flex-1 rounded-full border border-neutral-600 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 outline-none transition focus:border-neutral-400"
        />
        <button
          onClick={handleSave}
          className="rounded-full bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Changes take effect after restarting the app. Use modifiers like CommandOrControl, Shift, Alt.
      </p>
    </div>
  );
}
