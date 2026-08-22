import { motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  BookText,
  History as HistoryIcon,
  Home as HomeIcon,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Dropdown } from "../../components/Dropdown";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { DictationProvider } from "../../lib/useDictation";
import { cn } from "../../lib/utils";
import { learnNewVocabTerms } from "../../lib/vocabLearn";

/** Payload of the `dictation-edited` Tauri event fired by the backend's
 * post-paste AX watcher when it sees the user manually correct text in
 * the destination app within 60 s of a dictation. */
type DictationEditedPayload = {
  pasted: string;
  edited: string;
};

type PageMeta = {
  title: string;
  sub: string;
};

export const Layout = () => {
  return (
    <DictationProvider>
      <LayoutInner />
    </DictationProvider>
  );
};

/**
 * Theme modes, in the order the header button cycles through them.
 * "system" follows the OS via `prefers-color-scheme`; the other two pin it.
 */
const THEME_MODES = ["dark", "light", "system"] as const;
type ThemeMode = (typeof THEME_MODES)[number];

const THEME_LABEL_KEYS = {
  dark: "themeDark",
  light: "themeLight",
  system: "themeSystem",
} as const;

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === "system") return <Monitor className="size-[14px]" strokeWidth={2} />;
  if (mode === "dark") return <Moon className="size-[14px]" strokeWidth={2} />;
  return <Sun className="size-[14px]" strokeWidth={2} />;
}

/** Collapse a mode to the palette that should actually be painted. */
function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const LayoutInner = () => {
  const location = useLocation();
  const { t } = useI18n();
  const { hotkeySettings } = useAppStore();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = localStorage.getItem("dictateai.theme");
    return THEME_MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : "dark";
  });

  // Listen for the backend's `dictation-edited` event — fired when the
  // post-paste AX watcher sees the user manually correct text in the
  // destination app within ~60s of a dictation. We route the diff through
  // the same "Add 'X' to vocabulary?" toast prompt the History inline-edit
  // flow uses. Gated on the Auto-add vocabulary preference; if it's off,
  // the backend already skips spawning the watcher, but we re-check here
  // for belt-and-suspenders symmetry.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<DictationEditedPayload>("dictation-edited", (event) => {
      if (!hotkeySettings.autoAddVocabulary) return;
      const { pasted, edited } = event.payload;
      void learnNewVocabTerms(pasted, edited);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [hotkeySettings.autoAddVocabulary]);

  // Apply theme to <html> so token overrides cascade everywhere. Dark is the
  // base palette, so it's expressed by *removing* the attribute — same
  // contract the pre-paint script in index.html uses.
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      if (resolveTheme(theme) === "light") {
        root.setAttribute("data-theme", "light");
      } else {
        root.removeAttribute("data-theme");
      }
    };

    apply();
    localStorage.setItem("dictateai.theme", theme);

    // Only "system" needs to track the OS; an explicit choice is fixed.
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);

  const sidebarItems = [
    { icon: HomeIcon, label: t("navHome"), path: "/" },
    { icon: BookText, label: t("navVocabulary"), path: "/vocabulary" },
    { icon: HistoryIcon, label: t("navHistory"), path: "/history" },
    { icon: SettingsIcon, label: t("tabGeneral"), path: "/settings" },
  ];

  const pageMeta: Record<string, PageMeta> = {
    "/": { title: t("navHome"), sub: t("homeSub") },
    "/vocabulary": { title: t("navVocabulary"), sub: t("vocabularySub") },
    "/history": { title: t("navHistory"), sub: t("historySub") },
    "/settings": { title: t("tabGeneral"), sub: t("settingsSub") },
  };
  const currentPage = pageMeta[location.pathname] ?? pageMeta["/"];

  return (
    <>
      <div className="app-bg" aria-hidden="true" />
      <div
        className="relative z-[1] grid h-screen gap-3 p-3"
        style={{ gridTemplateColumns: "232px 1fr" }}
      >
        {/* ============ Sidebar ============ */}
        <aside className="panel relative flex flex-col overflow-hidden px-3 pt-3.5 pb-3">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, oklch(0.65 0.17 var(--ai-h) / 0.05), transparent 30%)",
            }}
          />

          {/* Brand */}
          <div className="relative flex items-center gap-2.5 px-1.5 pt-1 pb-4">
            <div
              className="size-8 shrink-0 overflow-hidden rounded-[9px]"
              style={{
                boxShadow:
                  "0 0 12px 1px rgba(42, 111, 219, 0.55), 0 0 28px 4px rgba(42, 111, 219, 0.25)",
              }}
            >
              <img
                src="/app-icon.png"
                alt="DictateAI"
                className="size-full object-cover"
              />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight" style={{ color: "var(--text)" }}>
                DictateAI
              </div>
              <div className="mono-label mt-px" style={{ fontSize: "9.5px" }}>
                Voice → Text
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="relative flex flex-col gap-px">
            {sidebarItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  cn(
                    "relative flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[12.5px] transition-colors",
                    isActive
                      ? "bg-[var(--hairline)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--hairline)] hover:text-[var(--text)]",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active-bar"
                        className="absolute top-1/2 left-[-12px] block h-4 w-[3px] -translate-y-1/2 rounded-[2px]"
                        style={{
                          background: "var(--ai)",
                          boxShadow: "0 0 8px var(--ai-glow)",
                        }}
                        transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    <span className="grid size-[14px] shrink-0 place-items-center">
                      <item.icon className="size-[14px]" strokeWidth={2} />
                    </span>
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* ============ Main ============ */}
        <section
          className="surface flex min-w-0 flex-col overflow-hidden"
          style={{ background: "var(--bg-elev-1)" }}
        >
          <header
            className="flex items-start gap-3 px-5 py-[14px]"
            style={{ borderBottom: "1px solid var(--hairline)", background: "var(--bg-elev-1)" }}
          >
            <div>
              <div
                className="text-[18px] font-semibold tracking-[-0.02em]"
                style={{ color: "var(--text)" }}
              >
                {currentPage.title}
              </div>
              <div className="mt-px text-[12px]" style={{ color: "var(--text-muted)" }}>
                {currentPage.sub}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Dropdown<ThemeMode>
                value={theme}
                className="dropdown-icon"
                ariaLabel={t("toggleThemeLabel")}
                options={THEME_MODES.map((mode) => ({
                  value: mode,
                  label: t(THEME_LABEL_KEYS[mode]),
                  leading: <ThemeIcon mode={mode} />,
                }))}
                onChange={setTheme}
                renderTriggerLabel={(option) => <ThemeIcon mode={option.value} />}
              />
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Route changes drop the previous DOM (no exit animation) and
             * the new page mounts with the global `.screen-fade` keyframe.
             * Pages render their own toolbar (Settings tabs, History
             * search, Vocabulary add-row) followed by a `.page-scroll`
             * wrapper — the only element that actually scrolls — so the
             * scrollbar sits flush below the page chrome and never runs
             * past the toolbar / table header. */}
            <div
              key={location.pathname}
              className="relative z-10 flex h-full min-h-0 flex-col screen-fade"
            >
              <Outlet />
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

