import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Target, Navigation, Map as MapIcon, Shield, Layers, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" 
  ? "http://127.0.0.1:8000" 
  : ""; // Empty string uses relative path (current domain) in production

// Custom classes and colors for EuroSAT
const TERRAIN_CONFIG = {
  AnnualCrop: { color: "#eab308", label: "Agricultural Field" },
  Forest: { color: "#22c55e", label: "Forest / Woods" },
  HerbaceousVegetation: { color: "#84cc16", label: "Wild Vegetation" },
  Highway: { color: "#64748b", label: "Highway / Main Road" },
  Industrial: { color: "#ef4444", label: "Industrial Zone" },
  Pasture: { color: "#10b981", label: "Open Field / Pasture" },
  PermanentCrop: { color: "#f59e0b", label: "Orchard / Plantation" },
  Residential: { color: "#3b82f6", label: "City / Residential" },
  River: { color: "#06b6d4", label: "River / Stream" },
  SeaLake: { color: "#2563eb", label: "Sea / Lake / Village Pond" }
};

// Component to handle map center changes
const MapScanner = ({ onMove }) => {
  const lastCall = useRef(0);
  
  useMapEvents({
    move: (e) => {
      const now = Date.now();
      if (now - lastCall.current > 300) { // 300ms throttle
        const center = e.target.getCenter();
        onMove(center.lat, center.lng, e.target.getZoom());
        lastCall.current = now;
      }
    },
    moveend: (e) => {
      const center = e.target.getCenter();
      onMove(center.lat, center.lng, e.target.getZoom());
    }
  });
  return null;
};

// Component to handle geolocation once on mount
const LocationMarker = ({ setCenter, onLocationFound }) => {
  const map = useMap();
  const hasLocated = useRef(false);
  
  useEffect(() => {
    if (hasLocated.current) return;
    
    map.locate().once("locationfound", (e) => {
      if (hasLocated.current) return;
      hasLocated.current = true;
      map.flyTo(e.latlng, 18);
      setCenter(e.latlng);
      onLocationFound(e.latlng);
    });
  }, [map]);
  
  return null;
};

function App() {
  const [center, setCenter] = useState({ lat: 48.8566, lng: 2.3522 }); // Default Paris
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('analysis');

  const lastRequest = useRef(null);
  const mapRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const fetchPrediction = useCallback(async (lat, lon, zoom) => {
    setLoading(true);
    setError(null);
    
    // Debounce/Cancel previous request if needed
    if (lastRequest.current) {
      lastRequest.current.cancel();
    }
    const source = axios.CancelToken.source();
    lastRequest.current = source;

    try {
      const response = await axios.get(`${API_BASE}/predict-coords`, {
        params: { lat, lon, zoom },
        cancelToken: source.token
      });
      
      const data = response.data;
      setPrediction(data);
      setHistory(prev => [data, ...prev].slice(0, 5));
    } catch (err) {
      if (!axios.isCancel(err)) {
        setError("AI Engine Offline");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setActiveTab('about');
    fetchPrediction(center.lat, center.lng, 16);
  }, []);

  const handleMapMove = (lat, lng, zoom) => {
    setCenter({ lat, lng });
    fetchPrediction(lat, lng, zoom);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const res = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
      if (res.data && res.data.length > 0) {
        const { lat, lon } = res.data[0];
        const newLat = parseFloat(lat);
        const newLon = parseFloat(lon);
        
        if (mapRef.current) {
          mapRef.current.flyTo([newLat, newLon], 18);
          handleMapMove(newLat, newLon, 18);
        }
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setIsSearching(false);
      setSearchQuery("");
    }
  };

  const goToMyLocation = () => {
    if (mapRef.current) {
      mapRef.current.locate().once("locationfound", (e) => {
        mapRef.current.flyTo(e.latlng, 18);
        handleMapMove(e.latlng.lat, e.latlng.lng, 18);
      });
    }
  };

  return (
    <div className="relative w-full h-full">
      {/* Map Layer */}
      <MapContainer 
        center={[center.lat, center.lng]} 
        zoom={16} 
        zoomControl={false}
        className="z-0"
        ref={mapRef}
      >
        <TileLayer
          url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
        />
        <MapScanner onMove={handleMapMove} />
        <LocationMarker setCenter={setCenter} onLocationFound={(ll) => fetchPrediction(ll.lat, ll.lng, 18)} />
      </MapContainer>

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-6">
        
        {/* Header */}
        <header className="flex justify-between items-start">
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass p-4 rounded-2xl flex items-center gap-4"
            >
              <div className="w-12 h-12 bg-white/10 rounded-xl overflow-hidden flex items-center justify-center p-1 shrink-0">
                <img src="/logo.png" alt="Terrain AI Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight">TERRAIN<span className="text-indigo-400">AI</span></h1>
                <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">Intelligent Earth Vision</p>
              </div>
            </motion.div>

          <div className="flex gap-2 pointer-events-auto">
             <form onSubmit={handleSearch} className="flex gap-2">
               <input 
                 type="text" 
                 placeholder="Search location..."
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="glass px-4 py-2 w-48 sm:w-64 text-white placeholder-white/50 focus:outline-none border border-white/10 rounded-xl text-sm"
               />
               <motion.button 
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 type="submit"
                 disabled={isSearching}
                 className="glass p-2 px-3 rounded-xl flex items-center justify-center min-w-[40px]"
               >
                 {isSearching ? <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /> : <Activity className="w-4 h-4 text-indigo-400 rotate-90" />}
               </motion.button>
             </form>

             <motion.button 
               whileHover={{ scale: 1.05 }}
               whileTap={{ scale: 0.95 }}
               className="glass p-3 rounded-xl"
               onClick={goToMyLocation}
               title="My Location"
             >
               <Navigation className="w-5 h-5 text-indigo-400" />
             </motion.button>
          </div>
        </header>

        {/* Central Scanner Overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative">
            {/* Outer Ring */}
            <motion.div 
              animate={{ rotate: 360, scale: [1, 1.05, 1] }}
              transition={{ 
                rotate: { duration: 10, repeat: Infinity, ease: "linear" },
                scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }
              }}
              className="w-64 h-64 border-4 border-dashed border-indigo-400/40 rounded-full shadow-[0_0_30px_rgba(129,140,248,0.2)]"
            />
            {/* Inner Scanning Bar */}
            <motion.div 
              animate={{ rotate: -360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 w-64 h-64 border-4 border-indigo-400 rounded-full border-t-transparent border-l-transparent shadow-[0_0_20px_rgba(129,140,248,0.4)]"
            />
            {/* Crosshair */}
            <Target className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 ${loading ? 'text-indigo-400 animate-pulse' : 'text-white'}`} />
            
            {/* Current Result Label */}
            <AnimatePresence>
              {prediction && !loading && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute -bottom-16 left-1/2 -translate-x-1/2 whitespace-nowrap"
                >
                  <div className="glass px-4 py-2 rounded-full border-b-2" style={{ borderColor: TERRAIN_CONFIG[prediction.prediction]?.color || '#fff' }}>
                    <span className="text-sm font-bold uppercase tracking-wider">
                      {TERRAIN_CONFIG[prediction.prediction]?.label || prediction.prediction}
                    </span>
                    <span className="ml-2 text-indigo-400 font-mono">
                      {(prediction.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Sidebar / Bottom Info */}
        <div className="flex justify-between items-end gap-6 h-full pt-24 pb-6 px-6 pointer-events-none">
          
          {/* Main Left Sidebar */}
          <motion.div 
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="glass w-80 rounded-3xl pointer-events-auto flex flex-col max-h-[650px] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10"
          >
            {/* Tabs Header */}
            <div className="flex gap-2 p-2 border-b border-white/10">
              {['analysis', 'about', 'contact'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{ 
                    backgroundColor: activeTab === tab ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                    border: activeTab === tab ? '1px solid rgba(129, 140, 248, 0.4)' : '1px solid transparent',
                    outline: 'none',
                    color: activeTab === tab ? '#fff' : '#94a3b8'
                  }}
                  className={`flex-1 py-2 text-[10px] uppercase font-black tracking-widest transition-all rounded-xl`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
              {activeTab === 'analysis' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-bold uppercase tracking-tighter">Real-time Analysis</h2>
                  </div>

                  <div className="space-y-4">
                    {prediction ? Object.entries(prediction.all_scores)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([name, score]) => (
                      <div key={name} className="space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400 font-medium">{TERRAIN_CONFIG[name]?.label || name}</span>
                          <span className="font-mono text-indigo-300">{(score * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-900/50 rounded-full overflow-hidden border border-white/5">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${score * 100}%` }}
                            className="h-full shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                            style={{ backgroundColor: TERRAIN_CONFIG[name]?.color }}
                          />
                        </div>
                      </div>
                    )) : (
                      <div className="text-center py-12 text-slate-500 italic text-sm">
                        <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
                        Scanning planetary surface...
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === 'about' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                   <div className="space-y-2">
                     <h2 className="text-lg font-bold">About Terrain AI</h2>
                     <p className="text-sm text-slate-400 leading-relaxed">
                       Terrain AI is an advanced land-use classification platform that leverages the **EuroSAT deep learning model**. 
                       By processing high-resolution Sentinel-2 satellite imagery in real-time, the system can distinguish between 10 different terrain categories with sub-meter precision.
                     </p>
                   </div>

                   <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
                     <h4 className="text-[10px] font-bold uppercase text-indigo-400 mb-2">Technical Core</h4>
                     <p className="text-[11px] text-slate-300">Deep Residual Networks (ResNet) trained on 27,000 labeled satellite images across Europe.</p>
                   </div>
                </motion.div>
              )}

              {activeTab === 'contact' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold">Contact Us</h2>
                    <p className="text-xs text-slate-500">Reach out to the lead developer</p>
                  </div>

                  <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-indigo-400">Developer</span>
                      <span className="text-sm font-semibold">Aryan Vimal Ejantkar</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-indigo-400">Email</span>
                      <span className="text-sm font-mono text-slate-300">aryanvimalejantkar@gmail.com</span>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-white/5">
                    <motion.button 
                      whileHover={{ scale: 1.02, backgroundColor: 'rgba(99, 102, 241, 0.5)' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => window.location.href = 'mailto:aryanvimalejantkar@gmail.com?subject=Terrain AI Query'}
                      style={{ 
                        backgroundColor: 'rgba(99, 102, 241, 0.4)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)'
                      }}
                      className="w-full py-4 border border-indigo-500/60 text-white rounded-2xl font-bold text-sm transition-all shadow-xl"
                    >
                      click here for queries
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </div>

            {error && (
              <div className="m-6 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-xs text-center font-bold">
                {error}
              </div>
            )}
          </motion.div>

          {/* Coordinates Panel */}
          <motion.div 
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="glass p-4 rounded-2xl flex gap-6 items-center pointer-events-auto self-end"
          >
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase font-bold">Latitude</span>
              <span className="font-mono text-sm">{center.lat.toFixed(6)}</span>
            </div>
            <div className="w-px h-8 bg-slate-700" />
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase font-bold">Longitude</span>
              <span className="font-mono text-sm">{center.lng.toFixed(6)}</span>
            </div>
          </motion.div>

        </div>

        {/* User Notifier - Floating Notification */}
        <AnimatePresence>
          {prediction && !loading && (
            <motion.div 
              key={prediction.prediction}
              initial={{ opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute bottom-24 right-6 z-20 pointer-events-auto"
            >
              <div className="glass p-4 rounded-2xl w-64 border-l-4" style={{ borderLeftColor: TERRAIN_CONFIG[prediction.prediction]?.color }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: TERRAIN_CONFIG[prediction.prediction]?.color }} />
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">New Detection</span>
                </div>
                <h3 className="text-lg font-bold leading-tight">
                  {TERRAIN_CONFIG[prediction.prediction]?.label || prediction.prediction}
                </h3>
                <div className="mt-2 flex items-center gap-2">
                   <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full" style={{ width: `${prediction.confidence * 100}%`, backgroundColor: TERRAIN_CONFIG[prediction.prediction]?.color }} />
                   </div>
                   <span className="text-xs font-mono">{(prediction.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

export default App;
