import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { 
  Home, 
  Keyboard, 
  Cpu, 
  Wand2, 
  History, 
  Mic2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

const sidebarItems = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: Keyboard, label: 'Hotkey', path: '/hotkey' },
  { icon: Cpu, label: 'Models', path: '/models' },
  { icon: Wand2, label: 'Rewrite Rules', path: '/rewrite-rules' },
  { icon: History, label: 'History', path: '/history' },
];

export const Layout = () => {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#E5E5E5] font-sans selection:bg-blue-500/30 selection:text-blue-200">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/[0.06] bg-[#0F0F0F] flex flex-col shrink-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.4)]">
            <Mic2 className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">DictateAI</span>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-1">
          {sidebarItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 group relative",
                  isActive 
                    ? "bg-white/[0.05] text-white" 
                    : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.02]"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn(
                    "w-4 h-4",
                    isActive ? "text-blue-500" : "group-hover:text-neutral-300"
                  )} />
                  <span className="text-sm font-medium">{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute left-0 w-0.5 h-4 bg-blue-500 rounded-full"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span className="text-xs font-medium text-neutral-400 uppercase tracking-widest">Listening Active</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[#0A0A0A] relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="h-full"
          >
            <div className="max-w-4xl mx-auto p-12">
              <Outlet />
            </div>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
};
