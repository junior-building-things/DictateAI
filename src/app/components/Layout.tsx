import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { BookText, Cpu, History, Home, Mic2, Wand2 } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router";
import { checkAccessibility } from "../../lib/commands";
import { getMicrophonePermissionState } from "../../lib/ui";
import { DictationProvider } from "../../lib/useDictation";
import { cn } from "../../lib/utils";

const sidebarItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: Cpu, label: "Models", path: "/models" },
  { icon: Wand2, label: "Rewrite Rules", path: "/rewrite-rules" },
  { icon: BookText, label: "Vocabulary", path: "/vocabulary" },
  { icon: History, label: "History", path: "/history" },
];

export const Layout = () => {
  return (
    <DictationProvider>
      <LayoutInner />
    </DictationProvider>
  );
};

const LayoutInner = () => {
  const location = useLocation();
  const [microphoneGranted, setMicrophoneGranted] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);

  const syncPermissions = useCallback(async () => {
    const [microphoneState, accessibilityState] = await Promise.all([
      getMicrophonePermissionState().catch(() => "unknown"),
      checkAccessibility().catch(() => false),
    ]);

    setMicrophoneGranted(microphoneState === "granted");
    setAccessibilityGranted(accessibilityState === true);
  }, []);

  useEffect(() => {
    void syncPermissions();

    const handleFocus = () => {
      void syncPermissions();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [syncPermissions]);

  const isReady = microphoneGranted && accessibilityGranted;
  const footerLabel = isReady ? "READY" : "PERMISSION NEEDED";
  const footerDescription = isReady
    ? "Trigger the hotkey to start dictating."
    : "Enable microphone and accessibility permissions.";

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#E5E5E5] font-sans selection:bg-blue-500/30 selection:text-blue-200">
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/[0.06] bg-[#0F0F0F]">
        <div className="flex items-center gap-3 p-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]">
            <Mic2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">DictateAI</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {sidebarItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-md px-3 py-2 transition-all duration-200",
                  isActive
                    ? "bg-white/[0.05] text-white"
                    : "text-neutral-500 hover:bg-white/[0.02] hover:text-neutral-300",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn(
                      "h-4 w-4",
                      isActive ? "text-blue-500" : "group-hover:text-neutral-300",
                    )}
                  />
                  <span className="text-sm font-medium">{item.label}</span>
                  {isActive ? (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute left-0 h-4 w-0.5 rounded-full bg-blue-500"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-3 px-2 py-2">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                isReady
                  ? "bg-blue-500 shadow-[0_0_8px_rgba(37,99,235,0.5)]"
                  : "bg-neutral-500 shadow-[0_0_8px_rgba(115,115,115,0.35)]",
              )}
            />
            <span className="text-xs font-medium uppercase tracking-widest text-neutral-400">
              {footerLabel}
            </span>
          </div>
          <p className="px-2 text-[11px] leading-relaxed text-neutral-500">
            {footerDescription}
          </p>
        </div>
      </aside>

      <main className="relative flex-1 overflow-y-auto bg-[#0A0A0A]">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="h-full"
          >
            <div className="mx-auto max-w-4xl p-12">
              <Outlet />
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

    </div>
  );
};
