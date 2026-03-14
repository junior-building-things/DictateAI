import React, { useState } from 'react';
import { Keyboard, MousePointer2, Settings2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

export const Hotkey = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [hotkey, setHotkey] = useState('⌥ + Space');
  const [autoPaste, setAutoPaste] = useState(true);

  const handleRecord = () => {
    setIsRecording(true);
    toast.info("Press keys to record...");
    setTimeout(() => {
      setIsRecording(false);
      setHotkey('⌘ + Shift + D');
      toast.success("Hotkey updated!");
    }, 2000);
  };

  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white font-sans">Hotkey Settings</h1>
        <p className="text-neutral-400">Configure your global trigger shortcut for DictateAI.</p>
      </header>

      {/* Hotkey Recorder */}
      <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 space-y-8">
        <div className="flex items-center gap-6">
          <div className="flex-1 space-y-4">
            <label className="text-sm font-medium text-neutral-400 uppercase tracking-widest block">Primary Shortcut</label>
            <div className={cn(
              "p-8 rounded-2xl bg-white/[0.02] border-2 border-dashed flex items-center justify-center transition-all duration-300",
              isRecording ? "border-blue-500 bg-blue-500/5 shadow-[0_0_30px_rgba(37,99,235,0.15)] scale-[1.02]" : "border-white/[0.1] hover:border-white/[0.2]"
            )}>
              <div className="text-center space-y-4">
                <AnimatePresence mode="wait">
                  {isRecording ? (
                    <motion.div
                      key="recording"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="text-3xl font-bold tracking-wider text-blue-500"
                    >
                      Recording...
                    </motion.div>
                  ) : (
                    <motion.div
                      key="static"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="flex items-center gap-2"
                    >
                      {hotkey.split(' + ').map((key, i) => (
                        <div key={i} className="px-5 py-3 rounded-xl bg-white/[0.05] border border-white/[0.1] text-2xl font-bold text-white shadow-xl min-w-[60px] flex items-center justify-center">
                          {key}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                
                <button 
                  onClick={handleRecord}
                  disabled={isRecording}
                  className="px-6 py-2 rounded-lg text-sm font-medium bg-white/[0.05] hover:bg-white/[0.1] text-white transition-all border border-white/[0.1] flex items-center gap-2 mx-auto"
                >
                  <Keyboard className="w-4 h-4" />
                  Record new hotkey
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Trigger Options */}
        <div className="grid grid-cols-2 gap-4">
          <OptionToggle 
            label="Trigger on key down" 
            checked={true}
            description="Start transcription as soon as keys are pressed."
          />
          <OptionToggle 
            label="Trigger on key release" 
            checked={false}
            description="Useful for avoiding system keyboard shortcuts."
          />
          <OptionToggle 
            label="Hold to dictate" 
            checked={true}
            description="Transcription active only while holding the hotkey."
          />
          <OptionToggle 
            label="Tap to start / stop" 
            checked={false}
            description="Toggle behavior for those who prefer not holding keys."
          />
        </div>

        <div className="pt-8 border-t border-white/[0.06] flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-white">Auto-paste after rewrite</p>
            <p className="text-xs text-neutral-500">Automatically inserts the rewritten message into the active text field.</p>
          </div>
          <button 
            onClick={() => setAutoPaste(!autoPaste)}
            className={cn(
              "w-12 h-6 rounded-full p-1 transition-all duration-300",
              autoPaste ? "bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]" : "bg-white/[0.1]"
            )}
          >
            <div className={cn(
              "w-4 h-4 bg-white rounded-full transition-all duration-300 transform",
              autoPaste ? "translate-x-6" : "translate-x-0"
            )} />
          </button>
        </div>
      </section>

      <div className="flex items-start gap-4 p-4 rounded-xl bg-blue-500/[0.05] border border-blue-500/20">
        <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-sm text-neutral-400">
          Make sure your chosen hotkey doesn't conflict with system shortcuts like <span className="text-blue-500 font-mono">⌘ + Space</span> (Spotlight) or <span className="text-blue-500 font-mono">⌥ + ⌘ + L</span> (Downloads).
        </p>
      </div>
    </div>
  );
};

const OptionToggle = ({ label, checked, description }: { label: string, checked: boolean, description: string }) => {
  const [val, setVal] = useState(checked);
  return (
    <div 
      className={cn(
        "p-4 rounded-xl border transition-all cursor-pointer select-none",
        val ? "bg-white/[0.04] border-white/[0.1]" : "bg-transparent border-white/[0.02] opacity-60"
      )}
      onClick={() => setVal(!val)}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className={cn(
          "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all",
          val ? "border-blue-500 bg-blue-500" : "border-neutral-700"
        )}>
          {val && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
        </div>
        <span className="text-sm font-medium text-white">{label}</span>
      </div>
      <p className="text-xs text-neutral-500 leading-relaxed pl-7">{description}</p>
    </div>
  );
};
