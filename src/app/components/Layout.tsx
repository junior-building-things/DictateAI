import { motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  BookText,
  History as HistoryIcon,
  Home as HomeIcon,
  Moon,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useI18n } from "../../lib/i18n";
import { DictationProvider } from "../../lib/useDictation";
import { cn } from "../../lib/utils";

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

const LayoutInner = () => {
  const location = useLocation();
  const { t } = useI18n();
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("dictateai.theme") as "dark" | "light" | null) ?? "dark";
  });

  // Apply theme to <html> so token overrides cascade everywhere.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
    localStorage.setItem("dictateai.theme", theme);
  }, [theme]);

  const sidebarItems = [
    { icon: HomeIcon, label: t("navHome"), path: "/" },
    { icon: HistoryIcon, label: t("navHistory"), path: "/history" },
    { icon: BookText, label: t("navVocabulary"), path: "/vocabulary" },
    { icon: SettingsIcon, label: "Settings", path: "/settings" },
  ];

  const pageMeta: Record<string, PageMeta> = {
    "/": { title: t("navHome"), sub: "Press the hotkey from anywhere." },
    "/history": { title: t("navHistory"), sub: "Every dictation, searchable." },
    "/vocabulary": { title: t("navVocabulary"), sub: "Custom terms preserved across rewrites." },
    "/settings": { title: "Settings", sub: "Permissions, models, languages, and rewrite rules." },
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
              <button
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="Toggle theme"
                className="grid size-8 place-items-center rounded-md transition-colors hover:!text-[var(--text)]"
                style={{
                  background: "transparent",
                  border: "1px solid var(--hairline)",
                  color: "var(--text-muted)",
                }}
              >
                {theme === "dark" ? (
                  <Sun className="size-[14px]" strokeWidth={2} />
                ) : (
                  <Moon className="size-[14px]" strokeWidth={2} />
                )}
              </button>
            </div>
          </header>

          <div className="relative flex-1 overflow-auto">
            {/* Route changes drop the previous DOM (no exit animation) and
             * the new page mounts with the global `.screen-fade` keyframe.
             * Pages render their own toolbar (Settings tabs, History
             * search, Vocabulary add-row) flush against the topbar's
             * hairline, then a `.page-body` wrapper holds the content. */}
            <div key={location.pathname} className="relative z-10 min-h-full screen-fade">
              <Outlet />
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

