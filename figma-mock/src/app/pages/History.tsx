import React, { useState } from 'react';
import { History as HistoryIcon, Search, Filter, Copy, CornerDownLeft, Star, Trash2, Calendar, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

const initialHistory = [
  {
    id: 1,
    time: "2:45 PM",
    date: "Mar 12, 2026",
    original: "uh hey can you send me the doc later",
    rewritten: "Hey, can you send me the document later?",
    favorited: true,
  },
  {
    id: 2,
    time: "1:15 PM",
    date: "Mar 12, 2026",
    original: "um i think we should probably reschedule the meeting for like tomorrow morning or something",
    rewritten: "I think we should reschedule the meeting for tomorrow morning.",
    favorited: false,
  },
  {
    id: 3,
    time: "10:30 AM",
    date: "Mar 12, 2026",
    original: "yeah just tell them that the report is finished and i will email it shortly",
    rewritten: "Tell them that the report is finished and I will email it shortly.",
    favorited: false,
  },
  {
    id: 4,
    time: "9:05 PM",
    date: "Mar 11, 2026",
    original: "hey sarah are you coming to the dinner tonight?",
    rewritten: "Hey Sarah, are you coming to the dinner tonight?",
    favorited: true,
  }
];

export const History = () => {
  const [items, setItems] = useState(initialHistory);
  const [search, setSearch] = useState('');

  const filteredItems = items.filter(item => 
    item.original.toLowerCase().includes(search.toLowerCase()) || 
    item.rewritten.toLowerCase().includes(search.toLowerCase())
  );

  const toggleFavorite = (id: number) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, favorited: !item.favorited } : item
    ));
    toast.success("Favorite updated!");
  };

  const deleteItem = (id: number) => {
    setItems(prev => prev.filter(item => item.id !== id));
    toast.success("Deleted from history!");
  };

  return (
    <div className="space-y-12">
      <header className="flex items-end justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white">History</h1>
          <p className="text-neutral-400">Review and re-insert recent dictations.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input 
              type="text" 
              placeholder="Search history..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-white/[0.03] border border-white/[0.06] rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 w-64 transition-all"
            />
          </div>
          <button className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {filteredItems.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="group bg-white/[0.02] border border-white/[0.04] rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.03] hover:border-white/[0.08] hover:shadow-xl hover:shadow-black/20"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.05] rounded-md">
                    <Calendar className="w-3 h-3 text-neutral-500" />
                    <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">{item.date}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.05] rounded-md">
                    <Clock className="w-3 h-3 text-neutral-500" />
                    <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">{item.time}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => toggleFavorite(item.id)}
                    className={cn(
                      "p-2 rounded-lg transition-all",
                      item.favorited ? "text-amber-500 bg-amber-500/10" : "text-neutral-500 hover:text-white hover:bg-white/[0.05]"
                    )}
                  >
                    <Star className={cn("w-4 h-4", item.favorited && "fill-current")} />
                  </button>
                  <button 
                    onClick={() => deleteItem(item.id)}
                    className="p-2 rounded-lg text-neutral-500 hover:text-red-500 hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-neutral-500 uppercase tracking-wider font-bold">Spoken</p>
                  <p className="text-sm text-neutral-400 italic font-medium leading-relaxed">"{item.original}"</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-blue-500 uppercase tracking-wider font-bold">Rewritten</p>
                  <p className="text-base text-white font-medium leading-relaxed">{item.rewritten}</p>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-white/[0.04]">
                <button 
                  onClick={() => toast.success("Copied to clipboard")}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
                <button 
                  onClick={() => toast.success("Inserted into active field")}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2"
                >
                  <CornerDownLeft className="w-4 h-4" />
                  Reinsert
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
