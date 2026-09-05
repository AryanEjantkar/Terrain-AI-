import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Target, Navigation, Map as MapIcon, Shield, Layers, Activity, Users, Globe, Info, Mail, UserPlus, Trash2, Edit2, UserCheck, Search, Star, AlertTriangle, Loader2, ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

// Import CONNECT utilities & services
import { getConvexHull } from './utils/convexHull';
import { getBoundingBox, formatDistance, getGoogleMapsDirectionsUrl } from './utils/geoUtils';
import { filterPlacesInPolygon } from './utils/pointInPolygon';
import { rankMeetingSpots } from './utils/meetingSpot';
import { fetchPlacesInArea, PLACE_CATEGORIES } from './services/placesService';
import { geocodeAddress } from './services/geocodingService';
import AddPersonModal from './components/Connect/AddPersonModal';

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" 
  ? "http://127.0.0.1:8000" 
  : ""; 

// Terrain configuration for EuroSAT
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

// Custom Leaflet pins for Connect Mode
const createCustomMarkerIcon = (label, isUser = false) => {
  const bgColor = isUser ? '#6366f1' : '#3b82f6';
  const borderColor = isUser ? '#a5b4fc' : '#93c5fd';
  
  const html = `
    <div style="
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(15, 23, 42, 0.9);
      backdrop-filter: blur(8px);
      border: 2px solid ${borderColor};
      padding: 4px 10px;
      border-radius: 9999px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      color: #ffffff;
      font-family: 'Outfit', sans-serif;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      transform: translate(-50%, -100%);
    ">
      <div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${bgColor}; box-shadow: 0 0 8px ${bgColor};"></div>
      <span>${label}</span>
    </div>
  `;

  return L.divIcon({ html, className: 'custom-leaflet-pin', iconSize: [0, 0], iconAnchor: [0, 0] });
};

const createPlaceMarkerIcon = (categoryIcon, isSelected = false, isBest = false) => {
  const bg = isBest ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : isSelected ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(30, 41, 59, 0.9)';
  const border = isBest ? '#fbbf24' : isSelected ? '#a5b4fc' : 'rgba(255,255,255,0.2)';
  const scale = isSelected || isBest ? 'scale(1.25)' : 'scale(1)';

  const html = `
    <div style="
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: ${bg};
      border: 2px solid ${border};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transform: translate(-50%, -50%) ${scale};
      transition: transform 0.2s ease;
    ">
      ${categoryIcon || '📍'}
    </div>
  `;

  return L.divIcon({ html, className: 'custom-place-pin', iconSize: [0, 0], iconAnchor: [0, 0] });
};

// Map scanner for Satellite AI prediction
const MapScanner = ({ onMove }) => {
  const lastCall = useRef(0);
  
  useMapEvents({
    move: (e) => {
      const now = Date.now();
      if (now - lastCall.current > 300) {
        const c = e.target.getCenter();
        onMove(c.lat, c.lng, e.target.getZoom());
        lastCall.current = now;
      }
    },
    moveend: (e) => {
      const c = e.target.getCenter();
      onMove(c.lat, c.lng, e.target.getZoom());
    }
  });
  return null;
};

// Map bounds adjuster for Connect mode
const MapBoundsAdjuster = ({ people, hullPoints, selectedPlace }) => {
  const map = useMap();

  useEffect(() => {
    if (selectedPlace && selectedPlace.lat && selectedPlace.lng) {
      map.flyTo([selectedPlace.lat, selectedPlace.lng], 16, { animate: true, duration: 1 });
      return;
    }

    const pointsToFit = (hullPoints && hullPoints.length > 0) ? hullPoints : people;
    if (pointsToFit && pointsToFit.length > 0) {
      const bounds = L.latLngBounds(pointsToFit.map(p => [p.lat, p.lng]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 15, animate: true });
      }
    }
  }, [map, people, hullPoints, selectedPlace]);

  return null;
};

function App() {
  const [activeTab, setActiveTab] = useState('connect'); // 'analysis' | 'connect' | 'about' | 'contact'
  const [center, setCenter] = useState({ lat: 17.3850, lng: 78.4867 }); // Hyderabad default
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false); // Collapsible floating panel state

  // Predict state
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastRequest = useRef(null);
  const mapRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Connect State
  const [people, setPeople] = useState([
    {
      id: 'user-default',
      name: 'You',
      lat: 17.3850,
      lng: 78.4867,
      address: 'Hyderabad, Telangana',
      isUser: true
    }
  ]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState(null);

  const [selectedCategory, setSelectedCategory] = useState('cafe');
  const [customPoiQuery, setCustomPoiQuery] = useState('');
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [bestSpot, setBestSpot] = useState(null);
  const [isExpandedArea, setIsExpandedArea] = useState(false);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Calculate Convex Hull dynamically whenever people change
  const hullPoints = useMemo(() => {
    if (!people || people.length < 3) return [];
    return getConvexHull(people);
  }, [people]);

  // Bounding box of group members
  const boundingBox = useMemo(() => getBoundingBox(people), [people]);

  // AI Prediction fetch
  const fetchPrediction = useCallback(async (lat, lon, zoom) => {
    setLoading(true);
    setError(null);
    if (lastRequest.current) lastRequest.current.cancel();

    const source = axios.CancelToken.source();
    lastRequest.current = source;

    try {
      const response = await axios.get(`${API_BASE}/predict-coords`, {
        params: { lat, lon, zoom },
        cancelToken: source.token
      });
      setPrediction(response.data);
    } catch (err) {
      if (!axios.isCancel(err)) {
        setError("AI Engine Offline");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'analysis') {
      fetchPrediction(center.lat, center.lng, 16);
    }
  }, [activeTab, center, fetchPrediction]);

  const handleMapMove = (lat, lng, zoom) => {
    setCenter({ lat, lng });
    if (activeTab === 'analysis') {
      fetchPrediction(lat, lng, zoom);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const res = await geocodeAddress(searchQuery.trim());
      if (res && res.lat && res.lng) {
        setCenter({ lat: res.lat, lng: res.lng });
        if (mapRef.current) {
          mapRef.current.flyTo([res.lat, res.lng], 16);
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
        mapRef.current.flyTo(e.latlng, 16);
        setCenter(e.latlng);
      });
    }
  };

  // Save Person (Add or Edit)
  const handleSavePerson = (personData) => {
    setPeople((prev) => {
      const existingIdx = prev.findIndex((p) => p.id === personData.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = personData;
        return updated;
      }
      return [...prev, personData];
    });
    setPlaces([]);
    setBestSpot(null);
  };

  // Remove Person
  const handleRemovePerson = (personId) => {
    setPeople((prev) => prev.filter((p) => p.id !== personId));
    setPlaces([]);
    setBestSpot(null);
  };

  // Search Places in Polygon Area
  const handleSearchPlaces = useCallback(async (catId = selectedCategory, customQ = customPoiQuery) => {
    if (!boundingBox) {
      setSearchError('Please add at least one person location to search places.');
      return;
    }

    setLoadingPlaces(true);
    setSearchError(null);
    setSelectedPlace(null);

    try {
      const rawPlaces = await fetchPlacesInArea(boundingBox, catId, customQ);

      if (!rawPlaces || rawPlaces.length === 0) {
        setSearchError('No places found in this area. Try another category.');
        setPlaces([]);
        setBestSpot(null);
        return;
      }

      const { insidePlaces, isExpanded } = filterPlacesInPolygon(
        rawPlaces,
        hullPoints.length >= 3 ? hullPoints : people
      );

      setIsExpandedArea(isExpanded);
      const { rankedPlaces, bestSpot: optimalSpot } = rankMeetingSpots(insidePlaces, people);

      setPlaces(rankedPlaces);
      setBestSpot(optimalSpot);
    } catch (err) {
      console.error('Place search error:', err);
      setSearchError(err.message || 'Failed to fetch places.');
    } finally {
      setLoadingPlaces(false);
    }
  }, [boundingBox, hullPoints, people, selectedCategory, customPoiQuery]);

  const polygonCoords = useMemo(() => {
    return (hullPoints && hullPoints.length >= 3) ? hullPoints.map(p => [p.lat, p.lng]) : [];
  }, [hullPoints]);

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden font-['Outfit',sans-serif]">
      
      {/* FULL SCREEN MAP LAYER */}
      <div className="absolute inset-0 z-0 w-full h-full">
        <MapContainer 
          center={[center.lat, center.lng]} 
          zoom={14} 
          zoomControl={false}
          className="w-full h-full"
          ref={mapRef}
        >
          {activeTab === 'analysis' ? (
            /* Satellite Tile Layer for Predict Feature */
            <TileLayer
              url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
            />
          ) : (
            /* 2D Vector Street Map for Connect Feature */
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
          )}

          {activeTab === 'analysis' && <MapScanner onMove={handleMapMove} />}
          {activeTab === 'connect' && (
            <MapBoundsAdjuster people={people} hullPoints={hullPoints} selectedPlace={selectedPlace} />
          )}

          {/* Connect Layer: Convex Hull Polygon */}
          {activeTab === 'connect' && polygonCoords.length >= 3 && (
            <Polygon
              positions={polygonCoords}
              pathOptions={{
                color: '#818cf8',
                weight: 3,
                fillColor: '#6366f1',
                fillOpacity: 0.22,
                dashArray: '6, 6'
              }}
            />
          )}

          {/* Connect Layer: People Markers */}
          {activeTab === 'connect' && people.map((person, idx) => (
            <Marker
              key={person.id || `person-${idx}`}
              position={[person.lat, person.lng]}
              icon={createCustomMarkerIcon(person.isUser ? `${person.name} (You)` : person.name, person.isUser)}
            >
              <Popup>
                <div className="p-1">
                  <strong className="text-sm text-slate-800">{person.name}</strong>
                  <p className="text-xs text-slate-600">{person.address}</p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Connect Layer: Places & POI Markers */}
          {activeTab === 'connect' && places.map((place) => {
            const isSelected = selectedPlace && selectedPlace.id === place.id;
            const isBest = bestSpot && bestSpot.id === place.id;

            return (
              <Marker
                key={place.id}
                position={[place.lat, place.lng]}
                icon={createPlaceMarkerIcon(place.categoryIcon, isSelected, isBest)}
                eventHandlers={{ click: () => setSelectedPlace(place) }}
              >
                <Popup>
                  <div className="p-1">
                    <div className="flex items-center gap-1">
                      <span>{place.categoryIcon}</span>
                      <strong className="text-sm">{place.name}</strong>
                    </div>
                    {isBest && <span className="text-[10px] font-bold text-amber-600 block mt-1">⭐ Best Meeting Spot</span>}
                    <p className="text-xs text-slate-500 mt-1">{place.address}</p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* TOP HEADER OVERLAY */}
      <header className="absolute top-6 left-6 right-6 z-20 pointer-events-none flex justify-between items-center gap-4">
        {/* Logo */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-3 px-4 rounded-2xl flex items-center gap-3 shadow-xl pointer-events-auto shrink-0"
        >
          <div style={{ width: '40px', height: '40px', minWidth: '40px', maxWidth: '40px', minHeight: '40px', maxHeight: '40px' }} className="bg-white/10 rounded-xl overflow-hidden flex items-center justify-center p-1 shrink-0">
            <img src="/logo.png" alt="Terrain AI Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white">TERRAIN<span className="text-indigo-400">AI</span></h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Earth Vision & Connect</p>
          </div>
        </motion.div>

        {/* Right Search Bar & CONNECT Mode Button */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input 
              type="text" 
              placeholder="Search location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="glass px-4 py-2.5 w-44 sm:w-64 text-white placeholder-white/50 focus:outline-none border border-white/10 rounded-xl text-sm shadow-xl"
            />
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={isSearching}
              className="glass p-2.5 px-3.5 rounded-xl flex items-center justify-center min-w-[42px] shadow-xl"
            >
              {isSearching ? <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /> : <Activity className="w-4 h-4 text-indigo-400 rotate-90" />}
            </motion.button>
          </form>

          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="glass p-3 rounded-xl shadow-xl"
            onClick={goToMyLocation}
            title="My Location"
          >
            <Navigation className="w-5 h-5 text-indigo-400" />
          </motion.button>

          {/* 🔗 CONNECT TOGGLE BUTTON - RIGHT NEXT TO SEARCH BAR */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setActiveTab(activeTab === 'connect' ? 'analysis' : 'connect')}
            style={{
              backgroundColor: activeTab === 'connect' ? 'rgba(99, 102, 241, 0.5)' : 'rgba(15, 23, 42, 0.75)',
              border: activeTab === 'connect' ? '1.5px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.15)'
            }}
            className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 text-white shadow-2xl backdrop-blur-xl transition-all"
          >
            {activeTab === 'connect' ? (
              <>
                <Globe className="w-4 h-4 text-indigo-300 animate-pulse" />
                <span>🛰 Satellite AI</span>
              </>
            ) : (
              <>
                <Users className="w-4 h-4 text-indigo-400" />
                <span>🔗 Connect</span>
              </>
            )}
          </motion.button>
        </div>
      </header>

      {/* SATELLITE AI SCANNER CROSSHAIR (Only active in Predict mode) */}
      {activeTab === 'analysis' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="relative">
            <motion.div 
              animate={{ rotate: 360, scale: [1, 1.05, 1] }}
              transition={{ rotate: { duration: 10, repeat: Infinity, ease: "linear" }, scale: { duration: 2, repeat: Infinity, ease: "easeInOut" } }}
              className="w-64 h-64 border-4 border-dashed border-indigo-400/40 rounded-full shadow-[0_0_30px_rgba(129,140,248,0.2)]"
            />
            <motion.div 
              animate={{ rotate: -360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 w-64 h-64 border-4 border-indigo-400 rounded-full border-t-transparent border-l-transparent shadow-[0_0_20px_rgba(129,140,248,0.4)]"
            />
            <Target className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 ${loading ? 'text-indigo-400 animate-pulse' : 'text-white'}`} />
            
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
      )}

      {/* FLOATING & COLLAPSIBLE LEFT SIDEBAR PANEL */}
      {!isAddModalOpen && (
        <div className="absolute left-6 top-[96px] bottom-6 z-20 pointer-events-none flex items-start">
        {isPanelCollapsed ? (
          /* COLLAPSED FLOATING BADGE BUTTON */
          <motion.button
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={() => setIsPanelCollapsed(false)}
            className="glass p-3.5 rounded-full pointer-events-auto text-white shadow-2xl flex items-center gap-2 border border-white/20 hover:scale-105 transition-all group"
            title="Expand Panel Controls"
          >
            <Menu className="w-5 h-5 text-indigo-400 group-hover:rotate-90 transition-all" />
            <span className="text-xs font-black uppercase tracking-wider pr-1">Panel</span>
          </motion.button>
        ) : (
          /* EXPANDED SIDEBAR PANEL (Wider w-96 sm:w-[420px] fitting Contact Us cleanly) */
          <motion.div 
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="glass w-96 sm:w-[420px] rounded-3xl pointer-events-auto flex flex-col h-full max-h-[calc(100vh-120px)] overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.8)] border border-white/15"
          >
            {/* Tabs Navigation Header & Minimize Control */}
            <div className="flex items-center justify-between p-2 border-b border-white/10 bg-black/30">
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 pr-2">
                {[
                  { id: 'connect', label: '🔗 Connect' },
                  { id: 'analysis', label: '🛰 Predict' },
                  { id: 'about', label: 'ℹ️ About' },
                  { id: 'contact', label: '📧 Contact Us' }
                ].map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      style={{ 
                        backgroundColor: isActive ? 'rgba(99, 102, 241, 0.45)' : 'transparent',
                        border: isActive ? '1px solid rgba(129, 140, 248, 0.6)' : '1px solid transparent',
                        color: isActive ? '#fff' : '#94a3b8'
                      }}
                      className="py-2 px-3 text-xs font-extrabold uppercase tracking-wider transition-all rounded-xl whitespace-nowrap shrink-0"
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Float / Collapse Button */}
              <button
                onClick={() => setIsPanelCollapsed(true)}
                title="Collapse Panel (View Full Map)"
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-all shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
              
              {/* 1. CONNECT TAB CONTENT */}
              {activeTab === 'connect' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
                  
                  {/* Connected People Section */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400">
                          Connected People ({people.length})
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          {people.length >= 3 ? `Convex Hull Polygon Active (${hullPoints.length} Vertices)` : 'Add 3+ people to form area boundary'}
                        </p>
                      </div>

                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => {
                          setEditingPerson(null);
                          setIsAddModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-indigo-500/30 border border-indigo-400/40 text-indigo-200 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shrink-0"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>+ Add Person</span>
                      </motion.button>
                    </div>

                    {people.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-white/5 border border-dashed border-white/10 text-center space-y-2">
                        <p className="text-xs text-slate-300 font-semibold">No location added yet</p>
                        <button
                          onClick={() => setIsAddModalOpen(true)}
                          className="px-4 py-2 bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg"
                        >
                          Add Your Location
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                        {people.map((person) => (
                          <div
                            key={person.id}
                            className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3 hover:bg-white/10 transition-all"
                          >
                            <div className="flex items-center gap-2.5 overflow-hidden">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${person.isUser ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-400/50' : 'bg-slate-700/50 text-slate-300 border border-slate-600'}`}>
                                {person.isUser ? <UserCheck className="w-4 h-4" /> : <MapIcon className="w-4 h-4" />}
                              </div>

                              <div className="overflow-hidden">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-white truncate">{person.name}</span>
                                  {person.isUser && person.name !== 'You' && (
                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-indigo-500/30 text-indigo-300 border border-indigo-500/40">You</span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-400 truncate">📍 {person.address}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  setEditingPerson(person);
                                  setIsAddModalOpen(true);
                                }}
                                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-all"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRemovePerson(person.id)}
                                className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-white/10 transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* POI Place Categories & Search Bar */}
                  <div className="pt-3 border-t border-white/10 space-y-3">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400">
                        Find Places Inside Area
                      </h3>
                      {loadingPlaces && (
                        <span className="text-[10px] text-indigo-300 font-mono flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Searching...
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
                              setSelectedCategory(cat.id);
                              handleSearchPlaces(cat.id, customPoiQuery);
                            }}
                            style={{
                              backgroundColor: isActive ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.05)',
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

                    {/* Custom Search Form */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSearchPlaces(selectedCategory, customPoiQuery);
                      }}
                      className="flex gap-2"
                    >
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Search custom place (Starbucks, PVR)..."
                          value={customPoiQuery}
                          onChange={(e) => setCustomPoiQuery(e.target.value)}
                          style={{
                            width: '100%',
                            paddingLeft: '2.5rem',
                            paddingRight: '0.75rem',
                            paddingTop: '0.6rem',
                            paddingBottom: '0.6rem',
                            borderRadius: '0.75rem',
                            background: 'rgba(0, 0, 0, 0.5)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            outline: 'none'
                          }}
                          className="placeholder-slate-400 focus:border-indigo-400 transition-all"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loadingPlaces}
                        style={{
                          padding: '0.6rem 1rem',
                          background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                          color: '#ffffff',
                          fontWeight: 800,
                          fontSize: '0.75rem',
                          borderRadius: '0.75rem',
                          border: 'none',
                          boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
                          cursor: 'pointer'
                        }}
                        className="flex items-center justify-center hover:opacity-90 transition-all disabled:opacity-50 shrink-0"
                      >
                        <span>Find</span>
                      </button>
                    </form>
                  </div>

                  {/* Error Banner */}
                  {searchError && (
                    <div className="p-3 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                      <span>{searchError}</span>
                    </div>
                  )}

                  {/* ⭐ Best Meeting Spot Banner */}
                  {bestSpot ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={() => setSelectedPlace(bestSpot)}
                      className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/20 via-indigo-900/40 to-slate-900 border-2 border-amber-400/60 shadow-xl space-y-3 cursor-pointer"
                    >
                      <div className="flex justify-between items-center">
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          <span>⭐ Best Meeting Spot</span>
                        </span>
                        <a
                          href={getGoogleMapsDirectionsUrl(bestSpot.lat, bestSpot.lng, bestSpot.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="px-2.5 py-1 bg-amber-400 text-slate-950 font-extrabold rounded-lg text-xs flex items-center gap-1 hover:bg-amber-300 transition-all"
                        >
                          <Navigation className="w-3 h-3" />
                          <span>Navigate</span>
                        </a>
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{bestSpot.categoryIcon || '☕'}</span>
                          <div>
                            <h4 className="text-sm font-black text-white">{bestSpot.name}</h4>
                            <p className="text-[11px] text-amber-300/90 font-medium">"Most convenient spot for group"</p>
                          </div>
                        </div>
                        <p className="text-xs text-slate-300 mt-1">📍 {bestSpot.address}</p>
                      </div>

                      {bestSpot.memberDistances && (
                        <div className="pt-2 border-t border-white/10 space-y-1">
                          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                            Individual Travel Distances
                          </p>
                          <div className="space-y-1">
                            {bestSpot.memberDistances.map((m) => (
                              <div key={m.personId} className="px-2 py-1 rounded-lg bg-black/30 text-[11px] flex justify-between text-slate-200">
                                <span>{m.personName}:</span>
                                <span className="font-mono text-amber-300 font-bold">{m.distanceFormatted}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <button
                      onClick={() => handleSearchPlaces()}
                      disabled={loadingPlaces}
                      className="w-full py-3 bg-gradient-to-r from-amber-500/20 via-indigo-500/20 to-purple-500/20 border border-amber-500/40 text-amber-200 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-amber-500/30 transition-all"
                    >
                      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                      <span>⭐ Find Best Meeting Spot</span>
                    </button>
                  )}

                  {/* Places Results List */}
                  {places.length > 0 && (
                    <div className="space-y-3 pt-2">
                      <h3 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400">
                        Recommended Places ({places.length})
                      </h3>
                      <div className="space-y-2">
                        {places.map((place) => (
                          <div
                            key={place.id}
                            onClick={() => setSelectedPlace(place)}
                            style={{
                              backgroundColor: selectedPlace && selectedPlace.id === place.id ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                              borderColor: selectedPlace && selectedPlace.id === place.id ? 'rgba(129, 140, 248, 0.6)' : 'rgba(255, 255, 255, 0.1)'
                            }}
                            className="p-3 rounded-2xl border transition-all cursor-pointer space-y-2"
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <span className="text-lg shrink-0 p-1 rounded-lg bg-white/10">{place.categoryIcon || '📍'}</span>
                                <div className="overflow-hidden">
                                  <h4 className="text-xs font-bold text-white truncate">{place.name}</h4>
                                  <p className="text-[10px] text-slate-400 truncate">📍 {place.address}</p>
                                </div>
                              </div>
                              <a
                                href={getGoogleMapsDirectionsUrl(place.lat, place.lng, place.name)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="px-2 py-1 bg-indigo-500/30 hover:bg-indigo-500/50 border border-indigo-400/40 text-indigo-200 rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0"
                              >
                                <Navigation className="w-3 h-3" />
                                <span>Directions</span>
                              </a>
                            </div>

                            {place.memberDistances && (
                              <div className="pt-1.5 border-t border-white/10 grid grid-cols-2 gap-1 text-[10px] text-slate-300">
                                {place.memberDistances.map((m) => (
                                  <div key={m.personId} className="flex justify-between bg-black/20 px-1.5 py-0.5 rounded">
                                    <span className="truncate">{m.personName}:</span>
                                    <span className="font-mono text-indigo-300 font-bold ml-1">{m.distanceFormatted}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* 2. PREDICT / ANALYSIS TAB CONTENT */}
              {activeTab === 'analysis' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-bold uppercase tracking-tighter text-white">Real-time Analysis</h2>
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

              {/* 3. ABOUT TAB CONTENT */}
              {activeTab === 'about' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                   <div className="space-y-2">
                     <h2 className="text-lg font-bold text-white">About Terrain AI</h2>
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

              {/* 4. CONTACT TAB CONTENT */}
              {activeTab === 'contact' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold text-white">Contact Us</h2>
                    <p className="text-xs text-slate-500">Reach out to the lead developer</p>
                  </div>

                  <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-indigo-400">Developer</span>
                      <span className="text-sm font-semibold text-white">Aryan Vimal Ejantkar</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-indigo-400">Email</span>
                      <span className="text-sm font-mono text-slate-300">aryanvimalejantkar@gmail.com</span>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-white/5">
                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => window.location.href = 'mailto:aryanvimalejantkar@gmail.com?subject=Terrain AI Query'}
                      className="w-full py-4 bg-indigo-500/40 border border-indigo-500/60 text-white rounded-2xl font-bold text-sm transition-all shadow-xl"
                    >
                      click here for queries
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </div>

            {error && activeTab === 'analysis' && (
              <div className="m-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-xs text-center font-bold">
                {error}
              </div>
            )}
          </motion.div>
        )}
      </div>
      )}

      {/* ROOT LEVEL ADD / EDIT PERSON MODAL (Renders z-[99999] at top window level) */}
      <AddPersonModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddPerson={handleSavePerson}
        editingPerson={editingPerson}
        isFirstPerson={people.length === 0}
      />
    </div>
  );
}

export default App;
