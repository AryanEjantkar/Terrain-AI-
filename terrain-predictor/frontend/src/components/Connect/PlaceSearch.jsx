import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { PLACE_CATEGORIES } from '../../services/placesService';

export default function PlaceSearch({
  selectedCategory,
  onSelectCategory,
  onSearch,
  loading = false
}) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(selectedCategory, query);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-300">
          Find Places Inside Area
        </h3>
        {loading && (
          <span className="text-[10px] text-indigo-300 flex items-center gap-1 font-mono">
            <Loader2 className="w-3 h-3 animate-spin" /> Searching POIs...
          </span>
        )}
      </div>

      {/* Category Pills */}
      <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
        {PLACE_CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                onSelectCategory(cat.id);
                onSearch(cat.id, query);
              }}
              style={{
                backgroundColor: isActive ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                border: isActive ? '1px solid rgba(129, 140, 248, 0.6)' : '1px solid rgba(255, 255, 255, 0.1)'
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all ${isActive ? 'text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Clean Single Search Form (NO duplicate search icon) */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          placeholder="Search custom place (e.g. Starbucks, PVR)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400 text-xs transition-all"
        />

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1 shadow-md disabled:opacity-50 transition-all shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          <span>Find Places</span>
        </motion.button>
      </form>
    </div>
  );
}
