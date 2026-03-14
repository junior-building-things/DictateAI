import React, { useState } from 'react';
import { Wand2, Info, Check, CornerDownRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

export const RewriteRules = () => {
  const [rules, setRules] = useState({
    filler: true,
    repeats: true,
    corrections: true,
    preserve: false,
    punctuation: true,
  });

  const toggleRule = (key: keyof typeof rules) => {
    setRules(prev => ({ ...prev, [key]: !prev[key] }));
    toast.success("Rule updated!");
  };

  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">Rewrite Rules</h1>
        <p className="text-neutral-400">Customize how DictateAI cleans and rephrases your spoken words.</p>
      </header>

      <div className="grid grid-cols-1 gap-8">
        {/* Core Rules Grid */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3 pb-6 border-b border-white/[0.06]">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Standard Cleanup</h2>
              <p className="text-sm text-neutral-500">Enable or disable specific cleanup filters.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4">
            <RuleItem 
              label="Remove filler words" 
              description="Eliminate 'um', 'uh', 'like', and other pauses."
              active={rules.filler}
              onClick={() => toggleRule('filler')}
            />
            <RuleItem 
              label="Remove repeated words" 
              description="Clean up stutters and accidental repetitions."
              active={rules.repeats}
              onClick={() => toggleRule('repeats')}
            />
            <RuleItem 
              label="Remove false starts" 
              description="Discard phrases that you immediately corrected."
              active={rules.corrections}
              onClick={() => toggleRule('corrections')}
            />
            <RuleItem 
              label="Preserve original wording" 
              description="Stay as close as possible to exactly what you said."
              active={rules.preserve}
              onClick={() => toggleRule('preserve')}
            />
            <RuleItem 
              label="Intelligent punctuation" 
              description="Add commas, periods, and question marks contextually."
              active={rules.punctuation}
              onClick={() => toggleRule('punctuation')}
            />
          </div>
        </section>

        {/* Custom Prompt Box */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <CornerDownRight className="w-5 h-5 text-violet-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Advanced Rewriting</h2>
              <p className="text-sm text-neutral-500">Provide custom instructions for the AI rewrite engine.</p>
            </div>
          </div>

          <div className="space-y-4 pt-4">
            <label className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold block">Custom System Prompt</label>
            <textarea 
              defaultValue="Rewrite spoken text into a clean message while keeping the user’s wording and tone natural but professional. Ensure no filler words are present."
              className="w-full h-32 bg-white/[0.02] border border-white/[0.08] rounded-xl p-4 text-sm text-neutral-300 focus:outline-none focus:ring-1 focus:ring-violet-500/50 resize-none transition-all placeholder:text-neutral-600"
              placeholder="E.g., Rewrite everything as a concise bullet point..."
            />
            <div className="flex items-center gap-2 p-3 rounded-lg bg-violet-500/[0.05] border border-violet-500/20">
              <Info className="w-4 h-4 text-violet-500 shrink-0" />
              <p className="text-xs text-neutral-400">
                Advanced models (like GPT-4o) follow complex instructions better than on-device models.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

const RuleItem = ({ label, description, active, onClick }: { label: string, description: string, active: boolean, onClick: () => void }) => (
  <div 
    onClick={onClick}
    className={cn(
      "p-4 rounded-xl border transition-all duration-300 cursor-pointer flex items-start gap-4 group",
      active ? "bg-white/[0.05] border-white/[0.1] shadow-lg shadow-black/20" : "bg-transparent border-white/[0.03] opacity-60 hover:opacity-100 hover:bg-white/[0.02]"
    )}
  >
    <div className={cn(
      "mt-1 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-300",
      active ? "bg-blue-600 border-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.4)]" : "border-neutral-700 group-hover:border-neutral-500"
    )}>
      {active && <Check className="w-3.5 h-3.5 text-white stroke-[3px]" />}
    </div>
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-white">{label}</h3>
      <p className="text-xs text-neutral-500 leading-relaxed">{description}</p>
    </div>
  </div>
);
