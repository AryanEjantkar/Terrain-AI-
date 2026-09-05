import React from 'react';
import { Star, Navigation, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';
import { getGoogleMapsDirectionsUrl } from '../../utils/geoUtils';

export default function MeetingSpotCard({
  bestSpot = null,
  onFindBestSpot,
  onSelectSpot,
  isExpandedArea = false,
  loading = false
}) {
  if (!bestSpot) {
    return (
      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-purple-500/10 border border-amber-500/30 text-center space-y-2">
        <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto text-amber-300">
          <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
        </div>
        <div>
          <h3 className="text-sm font-extrabold text-white">Find Best Meeting Spot</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Ranks places to minimize group travel distance
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onFindBestSpot}
          disabled={loading}
          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-indigo-600 text-white font-extrabold text-xs rounded-xl shadow-lg hover:brightness-110 transition-all disabled:opacity-50"
        >
          {loading ? 'Calculating Travel Burden...' : '⭐ Find Best Meeting Spot'}
        </motion.button>
      </div>
    );
  }

  const directionsUrl = getGoogleMapsDirectionsUrl(bestSpot.lat, bestSpot.lng, bestSpot.name);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={() => onSelectSpot(bestSpot)}
      className="p-4 rounded-3xl bg-gradient-to-br from-amber-500/20 via-indigo-900/40 to-slate-900 border-2 border-amber-400/60 shadow-xl space-y-3 cursor-pointer relative overflow-hidden"
    >
      {/* Badge Banner */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300 text-[10px] font-black uppercase tracking-widest">
          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
          <span>⭐ Best Meeting Spot</span>
        </div>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="px-3 py-1 bg-amber-400 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1 hover:bg-amber-300 transition-all shadow-md"
        >
          <Navigation className="w-3 h-3" />
          <span>Navigate</span>
        </a>
      </div>

      {/* Main Info */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{bestSpot.categoryIcon || '☕'}</span>
          <div>
            <h3 className="text-base font-black text-white">{bestSpot.name}</h3>
            <p className="text-xs text-amber-300/90 font-medium">
              "Most convenient spot for the group"
            </p>
          </div>
        </div>
        <p className="text-xs text-slate-300 flex items-center gap-1 mt-2">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>{bestSpot.address}</span>
        </p>
      </div>

      {isExpandedArea && (
        <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200">
          ⚠️ Note: Search radius was expanded slightly near polygon boundary to find the optimal meeting spot.
        </div>
      )}

      {/* Individual Travel Breakdown */}
      {bestSpot.memberDistances && bestSpot.memberDistances.length > 0 && (
        <div className="pt-2 border-t border-white/10 space-y-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Individual Travel Distances
          </p>
          <div className="space-y-1">
            {bestSpot.memberDistances.map((m) => (
              <div
                key={m.personId}
                className="px-2.5 py-1.5 rounded-xl bg-black/30 text-xs flex justify-between items-center text-slate-200 border border-white/5"
              >
                <span className="font-semibold">{m.personName}</span>
                <span className="font-mono text-amber-300 font-bold">{m.distanceFormatted}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
