import React from 'react';
import { MapPin, UserPlus, Trash2, Edit2, UserCheck } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PersonList({
  people = [],
  onOpenAddModal,
  onEditPerson,
  onRemovePerson
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400">
            Connected People ({people.length})
          </h3>
          <p className="text-[11px] text-slate-400">Add friends to generate area boundary</p>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onOpenAddModal}
          style={{
            backgroundColor: 'rgba(99, 102, 241, 0.25)',
            border: '1px solid rgba(129, 140, 248, 0.4)'
          }}
          className="px-3 py-1.5 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 shadow-md"
        >
          <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
          <span>+ Add Person</span>
        </motion.button>
      </div>

      {people.length === 0 ? (
        <div className="p-4 rounded-2xl bg-white/5 border border-dashed border-white/10 text-center space-y-2">
          <MapPin className="w-6 h-6 text-slate-500 mx-auto animate-bounce" />
          <p className="text-xs text-slate-300 font-semibold">No location added yet</p>
          <p className="text-[11px] text-slate-500">Click below to set your starting location</p>
          <button
            onClick={onOpenAddModal}
            className="mt-2 px-4 py-2 bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg hover:bg-indigo-600 transition-all"
          >
            Add Your Location
          </button>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
          {people.map((person) => (
            <motion.div
              key={person.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3 hover:bg-white/10 transition-all"
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${person.isUser ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-400/50' : 'bg-slate-700/50 text-slate-300 border border-slate-600'}`}>
                  {person.isUser ? <UserCheck className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                </div>

                <div className="overflow-hidden">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-white truncate">{person.name}</span>
                    {person.isUser && person.name !== 'You' && (
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-500/30 text-indigo-300 border border-indigo-500/40">
                        You
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">
                    📍 {person.address || `${person.lat.toFixed(4)}, ${person.lng.toFixed(4)}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onEditPerson(person)}
                  title="Edit Location"
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-all"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onRemovePerson(person.id)}
                  title="Remove Person"
                  className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-white/10 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
