import React, { useState } from 'react';
import { Cpu, Zap, Activity, ShieldCheck, ChevronDown, Check, Info, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

export const Models = () => {
  const [speechProvider, setSpeechProvider] = useState('OpenAI');
  const [speechModel, setSpeechModel] = useState('Whisper Large v3');
  const [speechApiKey, setSpeechApiKey] = useState('sk-proj-7834298472938472938472938');
  const [rewriteProvider, setRewriteProvider] = useState('OpenAI');
  const [rewriteModel, setRewriteModel] = useState('GPT-4o Mini');
  const [rewriteApiKey, setRewriteApiKey] = useState('sk-proj-7834298472938472938472938');

  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">Models Configuration</h1>
        <p className="text-neutral-400">Configure speech-to-text and AI rewrite engines.</p>
      </header>

      {/* Speech Model Section */}
      <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 space-y-8 relative overflow-hidden">
        <div className="flex items-center gap-3 pb-6 border-b border-white/[0.06]">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Speech-to-Text Model</h2>
            <p className="text-sm text-neutral-500">How your voice is transcribed into text.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold">Model Provider</label>
            <Select 
              value={speechProvider} 
              onChange={setSpeechProvider} 
              options={['OpenAI', 'Google', 'Local / On-device']} 
            />
          </div>
          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold">Select Model</label>
            <Select 
              value={speechModel} 
              onChange={setSpeechModel} 
              options={
                speechProvider === 'OpenAI' ? ['GPT-4o Transcribe', 'Whisper Large v3', 'Whisper Base'] :
                speechProvider === 'Google' ? ['Gemini Speech', 'Chirp v2'] :
                ['Fast On-device', 'Accurate On-device']
              } 
            />
          </div>
        </div>

        {speechProvider !== 'Local / On-device' && (
          <div className="space-y-2 pt-2">
            <label className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold block">
              {speechProvider} API Key
            </label>
            <div className="relative group">
              <input 
                type="password" 
                value={speechApiKey}
                onChange={(e) => setSpeechApiKey(e.target.value)}
                placeholder={`Enter ${speechProvider} API Key...`}
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-neutral-300 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all font-mono"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => toast.success("API Key saved!")}
                  className="px-3 py-1 bg-blue-600 rounded text-[10px] font-bold text-white uppercase tracking-wider"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-6 pt-4">
          <LatencyBadge value="~400ms" />
          <AccuracyBadge value="98.5%" />
          <CostBadge value="$0.006 / min" />
        </div>
      </section>

      {/* Rewrite Model Section */}
      <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 space-y-8 relative overflow-hidden">
        <div className="flex items-center gap-3 pb-6 border-b border-white/[0.06]">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-violet-500" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Rewrite Engine</h2>
            <p className="text-sm text-neutral-500">How transcription is cleaned and formatted.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold">Model Provider</label>
            <Select 
              value={rewriteProvider} 
              onChange={setRewriteProvider} 
              options={['OpenAI', 'Google', 'Local / On-device']} 
            />
          </div>
          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold">Select Model</label>
            <Select 
              value={rewriteModel} 
              onChange={setRewriteModel} 
              options={
                rewriteProvider === 'OpenAI' ? ['GPT-4o Mini', 'GPT-4.1', 'GPT-4o'] :
                rewriteProvider === 'Google' ? ['Gemini 2.5 Flash', 'Gemini 2.5 Pro'] :
                ['DeepSeek R1 Distill', 'Mistral 7B Tiny']
              } 
            />
          </div>
        </div>

        {rewriteProvider !== 'Local / On-device' && (
          <div className="space-y-2 pt-2">
            <label className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold block">
              {rewriteProvider} API Key
            </label>
            <div className="relative group">
              <input 
                type="password" 
                value={rewriteApiKey}
                onChange={(e) => setRewriteApiKey(e.target.value)}
                placeholder={`Enter ${rewriteProvider} API Key...`}
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-neutral-300 focus:outline-none focus:ring-1 focus:ring-violet-500/50 transition-all font-mono"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => toast.success("API Key saved!")}
                  className="px-3 py-1 bg-violet-600 rounded text-[10px] font-bold text-white uppercase tracking-wider"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="pt-6 border-t border-white/[0.04]">
          <Link 
            to="/rewrite-rules"
            className="group flex items-center gap-2 text-sm font-medium text-violet-400 hover:text-violet-300 transition-colors w-fit"
          >
            Modify rewrite rules
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      <div className="flex items-start gap-4 p-4 rounded-xl bg-violet-500/[0.05] border border-violet-500/20">
        <Info className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
        <p className="text-sm text-neutral-400">
          On-device models require ~4GB of VRAM and may increase CPU usage. Cloud models require an active internet connection but offer higher accuracy and speed.
        </p>
      </div>
    </div>
  );
};

const Select = ({ value, onChange, options }: { value: string, onChange: (v: string) => void, options: string[] }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm font-medium text-white transition-all hover:bg-white/[0.05] focus:ring-1 focus:ring-blue-500/50"
      >
        {value}
        <ChevronDown className={cn("w-4 h-4 text-neutral-500 transition-transform", isOpen && "rotate-180")} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 4, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute top-full left-0 w-full z-50 bg-[#161616] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden py-1"
            >
              {options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    onChange(opt);
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-neutral-400 hover:bg-white/[0.05] hover:text-white transition-colors text-left"
                >
                  {opt}
                  {value === opt && <Check className="w-4 h-4 text-blue-500" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

const LatencyBadge = ({ value }: { value: string }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
    <Activity className="w-3 h-3 text-emerald-500" />
    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">{value} Latency</span>
  </div>
);

const AccuracyBadge = ({ value }: { value: string }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full">
    <ShieldCheck className="w-3 h-3 text-blue-500" />
    <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">{value} Accuracy</span>
  </div>
);

const CostBadge = ({ value }: { value: string }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.05] border border-white/[0.1] rounded-full">
    <Zap className="w-3 h-3 text-neutral-400" />
    <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">{value} Cost</span>
  </div>
);
