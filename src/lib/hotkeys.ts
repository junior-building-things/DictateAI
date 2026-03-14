const DISPLAY_TO_TAURI: Record<string, string> = {
  "⌘": "CommandOrControl",
  "⌥": "Alt",
  Shift: "Shift",
  Space: "Space",
  Enter: "Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
};

const TAURI_TO_DISPLAY: Record<string, string> = {
  CommandOrControl: "⌘",
  Command: "⌘",
  Control: "⌘",
  Alt: "⌥",
  Option: "⌥",
  Shift: "Shift",
  Space: "Space",
  Enter: "Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
};

export function displayHotkeyFromTauri(hotkey: string) {
  return hotkey
    .split("+")
    .map((part) => TAURI_TO_DISPLAY[part] ?? part.toUpperCase())
    .join(" + ");
}

export function tauriHotkeyFromDisplay(hotkey: string) {
  return hotkey
    .split(" + ")
    .map((part) => DISPLAY_TO_TAURI[part] ?? part.toUpperCase())
    .join("+");
}
