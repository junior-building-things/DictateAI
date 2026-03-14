import React, { useState } from 'react';
import { Mic2, Activity, ShieldCheck, Keyboard, Copy, CornerDownLeft, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

export const Home = () => {
  const [isDictating, setIsDictating] = useState(false);
  const [testResult, setTestResult] = useState<{ original: string; rewritten: string } | null>(null);

  const startTest = () => {
    setIsDictating(true);
    setTimeout(() => {
      setIsDictating(false);
      setTestResult({
        original: "uh hey can you send me the doc later",
        rewritten: "Hey, can you send me the document later?"
      });
      toast.success("Transcription complete!");
    }, 2000);
  };

  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">DictateAI</h1>
        <p className="text-neutral-400">Welcome back. Ready to transcribe and rewrite.</p>
      </header>

      {/* Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatusCard 
          icon={Mic2} 
          label="Microphone" 
          status="active" 
          value="System Default"
        />
        <StatusCard 
          icon={ShieldCheck} 
          label="Permissions" 
          status="active" 
          value="Accessibility On"
        />
        <StatusCard 
          icon={Keyboard} 
          label="Hotkey" 
          status="active" 
          value="⌥ + Space"
        />
      </div>

      {/* Quick Test Panel */}
      <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 space-y-8 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:opacity-40 transition-opacity">
          <Activity className="w-24 h-24 text-blue-500" />
        </div>

        <div className="text-center space-y-6 relative z-10">
          <button 
            onClick={startTest}
            disabled={isDictating}
            className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center mx-auto transition-all duration-300 relative group",
              isDictating 
                ? "bg-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)]" 
                : "bg-blue-600 hover:bg-blue-500 shadow-[0_0_30px_rgba(37,99,235,0.3)] hover:scale-105"
            )}
          >
            <AnimatePresence mode="wait">
              {isDictating ? (
                <motion.div
                  key="recording"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: [0.8, 1.2, 0.8] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="w-10 h-10 bg-white rounded-sm"
                />
              ) : (
                <Mic2 key="mic" className="w-10 h-10 text-white" />
              )}
            </AnimatePresence>
          </button>
          
          <div className="space-y-2">
            <h3 className="text-xl font-medium text-white">
              {isDictating ? "Listening..." : "Press hotkey or click to dictate"}
            </h3>
            <p className="text-neutral-500 text-sm italic">"Uh, hey, can you send me that doc..."</p>
          </div>
        </div>

        {/* Example Flow UI */}
        <AnimatePresence>
          {testResult && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6 pt-8 border-t border-white/[0.06]"
            >
              <div className="space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">Spoken</span>
                  <p className="text-neutral-300 bg-white/[0.02] p-4 rounded-xl border border-white/[0.04]">
                    {testResult.original}
                  </p>
                </div>
                
                <div className="flex justify-center">
                  <div className="w-px h-6 bg-gradient-to-b from-blue-500/50 to-transparent" />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-blue-500 font-bold">Rewritten Output</span>
                  <p className="text-white bg-blue-500/[0.05] p-4 rounded-xl border border-blue-500/20 font-medium">
                    {testResult.rewritten}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button 
                  onClick={() => setTestResult(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Retry
                </button>
                <button 
                  onClick={() => toast.success("Copied to clipboard")}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
                <button 
                  onClick={() => toast.success("Inserted into active field")}
                  className="px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2"
                >
                  <CornerDownLeft className="w-4 h-4" />
                  Insert
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
};

const StatusCard = ({ icon: Icon, label, status, value }: { icon: any, label: string, status: 'active' | 'inactive', value: string }) => (
  <div className="p-4 bg-white/[0.02] border border-white/[0.04] rounded-xl space-y-3">
    <div className="flex items-center justify-between">
      <div className="p-2 bg-white/[0.03] rounded-lg">
        <Icon className="w-4 h-4 text-neutral-400" />
      </div>
      <div className={cn(
        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
        status === 'active' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
      )}>
        {status}
      </div>
    </div>
    <div className="space-y-1">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-sm font-medium text-white">{value}</p>
    </div>
  </div>
);
