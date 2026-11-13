import React from 'react';
import { Navigation, MapPin, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { getGoogleMapsDirectionsUrl } from '../../utils/geoUtils';

export default function PlaceCard({
  place,
  isSelected = false,
  isBest = false,
  onSelectPlace
}) {
  const directionsUrl = getGoogleMapsDirectionsUrl(place.lat, place.lng, place.name);

  return (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={() => onSelectPlace(place)}
      style={{
        backgroundColor: isBest
          ? 'rgba(245, 158, 11, 0.15)'
          : isSelected
          ? 'rgba(99, 102, 241, 0.2)'
          : 'rgba(255, 255, 255, 0.05)',
        borderColor: isBest
          ? 'rgba(245, 158, 11, 0.4)'
          : isSelected
          ? 'rgba(129, 140, 248, 0.5)'
          : 'rgba(255, 255, 255, 0.1)'
      }}
      className="p-3.5 rounded-2xl border transition-all cursor-pointer space-y-2.5 relative overflow-hidden"
    >
      {/* Top Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="text-xl shrink-0 p-1.5 rounded-xl bg-white/10">{place.categoryIcon || '📍'}</span>
          <div className="overflow-hidden">
            <h4 className="text-sm font-bold text-white truncate">{place.name}</h4>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className="text-[10px] text-indigo-300/90 font-medium">
                {place.category}
              </span>
              {place.associatedMall && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  🏬 Inside {place.associatedMall}
                </span>
              )}
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                place.isInsidePolygon
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }`}>
                {place.isInsidePolygon ? '✓ Inside Group Area' : '📍 Nearby Outside Group Area'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-1">
              <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
              <span>{place.address}</span>
            </p>
          </div>
        </div>

        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="px-2.5 py-1.5 bg-indigo-500/30 hover:bg-indigo-500/50 border border-indigo-400/40 text-indigo-200 rounded-xl text-xs font-bold flex items-center gap-1 shrink-0 transition-all"
          title="Open Directions in Google Maps"
        >
          <Navigation className="w-3.5 h-3.5" />
          <span>Directions</span>
        </a>
      </div>

      {/* Member Distances Breakdown */}
      {place.memberDistances && place.memberDistances.length > 0 && (
        <div className="pt-2 border-t border-white/10 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Travel distance per member
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {place.memberDistances.map((m) => (
              <div
                key={m.personId}
                className="px-2 py-1 rounded-lg bg-black/20 text-[11px] flex justify-between items-center text-slate-300"
              >
                <span className="truncate max-w-[90px]">{m.personName}:</span>
                <span className="font-mono text-indigo-300 font-bold ml-1">{m.distanceFormatted}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
