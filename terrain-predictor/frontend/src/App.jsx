import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { 
  Target, Navigation, Map as MapIcon, Shield, Layers, Activity, Users, Globe, 
  Info, Mail, UserPlus, Trash2, Edit2, UserCheck, Search, Star, AlertTriangle, 
  Loader2, ChevronLeft, ChevronRight, Menu, CheckCircle2, Compass, Sparkles,
  Building2, MessageSquare, Send
} from 'lucide-react';
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
  AnnualCrop: { color: "#eab308", label: "Agricultural Field 🌾" },
  Forest: { color: "#22c55e", label: "Forest / Woods 🌲" },
  HerbaceousVegetation: { color: "#84cc16", label: "Wild Vegetation 🌿" },
  Highway: { color: "#64748b", label: "Highway / Main Road 🛣️" },
  Industrial: { color: "#ef4444", label: "Industrial Zone 🏭" },
  Pasture: { color: "#10b981", label: "Open Field / Pasture 🐑" },
  PermanentCrop: { color: "#f59e0b", label: "Orchard / Plantation 🍎" },
  Residential: { color: "#3b82f6", label: "City / Residential 🏙️" },
  River: { color: "#06b6d4", label: "River / Stream 💧" },
  SeaLake: { color: "#2563eb", label: "Sea / Lake / Reservoir 🌊" }
};

// Feedback categories for Contact Us
const FEEDBACK_CATEGORIES = [
  "UI / Design Issue",
  "Mobile Responsiveness",
  "Map Issue",
  "Incorrect Location Results",
  "AI Prediction Issue",
  "Feature Suggestion",
  "General Feedback"
];

// Custom Leaflet pins for Connect Mode
const createCustomMarkerIcon = (label, isUser = false) => {
  const bgColor = isUser ? '#6366f1' : '#3b82f6';
  const borderColor = isUser ? '#a5b4fc' : '#93c5fd';
  
  const html = `
    <div style="
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(15, 23, 42, 0.92);
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
      if (now - lastCall.current > 350) {
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
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15, animate: true });
      }
    }
  }, [map, people, hullPoints, selectedPlace]);

  return null;
};

function App() {
  const [activeTab, setActiveTab] = useState('connect'); // 'analysis' | 'connect' | 'about' | 'contact'
  const [center, setCenter] = useState({ lat: 17.3850, lng: 78.4867 }); // Hyderabad default
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // Predict state & scan history
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scanHistory, setScanHistory] = useState([]);
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

  const [selectedCategory, setSelectedCategory] = useState('malls');
  const [customPoiQuery, setCustomPoiQuery] = useState('');
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [bestSpot, setBestSpot] = useState(null);
  const [isExpandedArea, setIsExpandedArea] = useState(false);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Contact Us Feedback State
  const [feedbackForm, setFeedbackForm] = useState({
    name: '',
    email: '',
    category: 'UI / Design Issue',
    description: ''
  });
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(null);
  const [feedbackError, setFeedbackError] = useState(null);

  // Calculate Convex Hull dynamically whenever people change
  const hullPoints = useMemo(() => {
    if (!people || people.length < 3) return [];
    return getConvexHull(people);
  }, [people]);

  // Bounding box of group members
  const boundingBox = useMemo(() => getBoundingBox(people), [people]);

  // AI Prediction fetch & record scan history
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

      // Add to scan history (avoid rapid duplicates at identical coords)
      if (response.data && response.data.prediction) {
        setScanHistory((prev) => {
          const isNearby = prev.some(
            (s) => Math.abs(s.lat - lat) < 0.0015 && Math.abs(s.lon - lon) < 0.0015
          );
          if (isNearby) return prev;

          const newScan = {
            id: `scan-${Date.now()}`,
            lat: Number(lat.toFixed(5)),
            lon: Number(lon.toFixed(5)),
            prediction: response.data.prediction,
            confidence: response.data.confidence,
            all_scores: response.data.all_scores,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          };
          return [newScan, ...prev.slice(0, 19)];
        });
      }
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

  // Fly to spot from scan history
  const handleSpotClick = (spot) => {
    setCenter({ lat: spot.lat, lng: spot.lon });
    setPrediction({
      prediction: spot.prediction,
      confidence: spot.confidence,
      all_scores: spot.all_scores
    });
    if (mapRef.current) {
      mapRef.current.flyTo([spot.lat, spot.lon], 16, { animate: true, duration: 1 });
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
        setSearchError(catId === 'famous'
          ? 'No famous spots found in this immediate area. Try expanding your search area or searching for a specific landmark above.'
          : 'No places found in this area. Try another category or custom query.');
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

  // Submit Feedback Handler
  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    setFeedbackSuccess(null);
    setFeedbackError(null);

    if (!feedbackForm.name.trim()) {
      setFeedbackError('Please enter your name.');
      return;
    }
    if (!feedbackForm.email.trim() || !feedbackForm.email.includes('@') || !feedbackForm.email.includes('.')) {
      setFeedbackError('Please enter a valid email address.');
      return;
    }
    if (!feedbackForm.description.trim() || feedbackForm.description.trim().length < 5) {
      setFeedbackError('Please describe your feedback or issue in at least 5 characters.');
      return;
    }

    setSubmittingFeedback(true);
    try {
      await axios.post(`${API_BASE}/api/feedback`, feedbackForm);
      setFeedbackSuccess('Thank you! Your feedback has been received. Our team will review it to improve Terrain AI.');
      setFeedbackForm({
        name: '',
        email: '',
        category: 'UI / Design Issue',
        description: ''
      });
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to submit feedback. Please check your network connection.';
      setFeedbackError(msg);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const polygonCoords = useMemo(() => {
    return (hullPoints && hullPoints.length >= 3) ? hullPoints.map(p => [p.lat, p.lng]) : [];
  }, [hullPoints]);

  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-x-hidden overflow-y-hidden font-['Outfit',sans-serif] select-none">
      
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
            /* Satellite Tile Layer for Predict Feature (ArcGIS World Imagery) */
            <TileLayer
              url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
            />
          ) : (
            /* 2D Vector Street Map for Connect Feature (OpenStreetMap standard raster tiles) */
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
                    {place.category && <p className="text-[11px] text-indigo-600 font-semibold">{place.category}</p>}
                    {place.associatedMall && (
                      <p className="text-[10px] text-purple-700 font-semibold mt-0.5">
                        🏬 Inside {place.associatedMall}
                      </p>
                    )}
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full inline-block mt-1 ${
                      place.isInsidePolygon ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {place.isInsidePolygon ? '✓ Inside Group Area' : '📍 Nearby Outside Group Area'}
                    </span>
                    {isBest && <span className="text-[10px] font-bold text-amber-600 block mt-1">⭐ Best Meeting Spot</span>}
                    <p className="text-xs text-slate-500 mt-1">{place.address}</p>
                    <a
                      href={getGoogleMapsDirectionsUrl(place.lat, place.lng, place.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-600 underline font-bold mt-1 inline-block"
                    >
                      Directions
                    </a>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* TOP HEADER OVERLAY (Fully Mobile-Responsive) */}
      <header className="absolute top-3 left-3 right-3 sm:top-6 sm:left-6 sm:right-6 z-20 pointer-events-none flex flex-wrap justify-between items-center gap-2">
        {/* Logo */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-2 sm:p-3 px-3 sm:px-4 rounded-2xl flex items-center gap-2.5 shadow-xl pointer-events-auto shrink-0"
        >
          <div style={{ width: '36px', height: '36px' }} className="bg-white/10 rounded-xl overflow-hidden flex items-center justify-center p-1 shrink-0">
            <img src="/logo.png" alt="Terrain AI Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-white leading-none">TERRAIN<span className="text-indigo-400">AI</span></h1>
            <p className="text-[9px] sm:text-[10px] text-slate-400 uppercase tracking-widest font-bold">Vision & Connect</p>
          </div>
        </motion.div>

        {/* Right Search Bar & Mode Switcher */}
        <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto">
          <form onSubmit={handleSearch} className="flex gap-1 sm:gap-2">
            <input 
              type="text" 
              placeholder="Search location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="glass px-3 py-2 sm:px-4 sm:py-2.5 w-32 sm:w-48 md:w-60 text-white placeholder-white/50 focus:outline-none border border-white/10 rounded-xl text-xs sm:text-sm shadow-xl"
            />
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={isSearching}
              className="glass p-2 sm:p-2.5 px-3 rounded-xl flex items-center justify-center min-w-[38px] shadow-xl"
            >
              {isSearching ? <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /> : <Activity className="w-4 h-4 text-indigo-400 rotate-90" />}
            </motion.button>
          </form>

          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="glass p-2 sm:p-3 rounded-xl shadow-xl shrink-0"
            onClick={goToMyLocation}
            title="My Location"
          >
            <Navigation className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />
          </motion.button>

          {/* Mode Switcher */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setActiveTab(activeTab === 'connect' ? 'analysis' : 'connect')}
            style={{
              backgroundColor: activeTab === 'connect' ? 'rgba(99, 102, 241, 0.5)' : 'rgba(15, 23, 42, 0.75)',
              border: activeTab === 'connect' ? '1.5px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.15)'
            }}
            className="px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-[11px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1.5 text-white shadow-2xl backdrop-blur-xl transition-all shrink-0"
          >
            {activeTab === 'connect' ? (
              <>
                <Globe className="w-3.5 h-3.5 text-indigo-300 animate-pulse" />
                <span className="hidden xs:inline">🛰 Satellite AI</span>
                <span className="xs:hidden">Predict</span>
              </>
            ) : (
              <>
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden xs:inline">🔗 Connect</span>
                <span className="xs:hidden">Connect</span>
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
              className="w-52 h-52 sm:w-64 sm:h-64 border-4 border-dashed border-indigo-400/40 rounded-full shadow-[0_0_30px_rgba(129,140,248,0.2)]"
            />
            <motion.div 
              animate={{ rotate: -360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 w-52 h-52 sm:w-64 sm:h-64 border-4 border-indigo-400 rounded-full border-t-transparent border-l-transparent shadow-[0_0_20px_rgba(129,140,248,0.4)]"
            />
            <Target className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 sm:w-10 sm:h-10 ${loading ? 'text-indigo-400 animate-pulse' : 'text-white'}`} />
            
            <AnimatePresence>
              {prediction && !loading && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute -bottom-16 left-1/2 -translate-x-1/2 whitespace-nowrap"
                >
                  <div className="glass px-4 py-2 rounded-full border-b-2 shadow-2xl" style={{ borderColor: TERRAIN_CONFIG[prediction.prediction]?.color || '#fff' }}>
                    <span className="text-xs sm:text-sm font-bold uppercase tracking-wider">
                      {TERRAIN_CONFIG[prediction.prediction]?.label || prediction.prediction}
                    </span>
                    <span className="ml-2 text-indigo-400 font-mono font-bold text-xs sm:text-sm">
                      {(prediction.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* FLOATING & COLLAPSIBLE SIDEBAR PANEL (Responsive: Desktop side drawer, Mobile bottom-sheet) */}
      {!isAddModalOpen && (
        <div className="absolute left-3 right-3 bottom-3 top-auto sm:left-6 sm:top-[96px] sm:bottom-6 sm:right-auto z-20 pointer-events-none flex items-start">
        {isPanelCollapsed ? (
          /* COLLAPSED FLOATING BADGE BUTTON */
          <motion.button
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={() => setIsPanelCollapsed(false)}
            className="glass p-3 sm:p-3.5 rounded-full pointer-events-auto text-white shadow-2xl flex items-center gap-2 border border-white/20 hover:scale-105 transition-all group"
            title="Expand Panel Controls"
          >
            <Menu className="w-5 h-5 text-indigo-400 group-hover:rotate-90 transition-all" />
            <span className="text-xs font-black uppercase tracking-wider pr-1">Controls</span>
          </motion.button>
        ) : (
          /* EXPANDED SIDEBAR PANEL */
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="glass w-full sm:w-[420px] max-h-[62vh] sm:max-h-[calc(100vh-120px)] rounded-3xl pointer-events-auto flex flex-col overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.85)] border border-white/15"
          >
            {/* Tabs Navigation Header & Minimize Control */}
            <div className="flex items-center justify-between p-2 sm:p-2.5 border-b border-white/10 bg-black/30">
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
                      className="py-1.5 sm:py-2 px-2.5 sm:px-3 text-[11px] sm:text-xs font-extrabold uppercase tracking-wider transition-all rounded-xl whitespace-nowrap shrink-0"
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Minimize / Collapse Button */}
              <button
                onClick={() => setIsPanelCollapsed(true)}
                title="Collapse Panel (View Full Map)"
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-all shrink-0"
              >
                <ChevronLeft className="w-4 h-4 hidden sm:block" />
                <ChevronRight className="w-4 h-4 rotate-90 sm:hidden" />
              </button>
            </div>

            {/* Panel Content (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 scrollbar-thin">
              
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
                          {people.length >= 3 ? `Convex Hull Polygon Active (${hullPoints.length} Vertices)` : 'Add 3+ people to form boundary'}
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
                        <p className="text-xs text-slate-300 font-semibold">No locations added yet</p>
                        <button
                          onClick={() => setIsAddModalOpen(true)}
                          className="px-4 py-2 bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg"
                        >
                          Add Your Location
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1 scrollbar-thin">
                        {people.map((person) => (
                          <div
                            key={person.id}
                            className="p-2.5 sm:p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3 hover:bg-white/10 transition-all"
                          >
                            <div className="flex items-center gap-2.5 overflow-hidden">
                              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 ${person.isUser ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-400/50' : 'bg-slate-700/50 text-slate-300 border border-slate-600'}`}>
                                {person.isUser ? <UserCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <MapIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
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
                                title="Edit Location"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRemovePerson(person.id)}
                                className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-white/10 transition-all"
                                title="Remove Location"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 9 POI Categories & Custom Place Search */}
                  <div className="pt-3 border-t border-white/10 space-y-3">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400">
                        Places Discovery (9 Categories)
                      </h3>
                      {loadingPlaces && (
                        <span className="text-[10px] text-indigo-300 font-mono flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Searching...
                        </span>
                      )}
                    </div>

                    {/* 9 Category Horizontal Pills */}
                    <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
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
                          placeholder="Search specific place (Inorbit, PVR, Cafe)..."
                          value={customPoiQuery}
                          onChange={(e) => setCustomPoiQuery(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/50 border border-white/15 text-white text-xs placeholder-slate-400 focus:outline-none focus:border-indigo-400 transition-all"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loadingPlaces}
                        className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-extrabold text-xs rounded-xl shadow-lg hover:opacity-90 disabled:opacity-50 transition-all shrink-0"
                      >
                        Find
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
                          <span className="text-xl">{bestSpot.categoryIcon || '🏬'}</span>
                          <div>
                            <h4 className="text-sm font-black text-white">{bestSpot.name}</h4>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              <span className="text-[10px] text-amber-300/90 font-medium">
                                Optimal Centroid Spot
                              </span>
                              {bestSpot.associatedMall && (
                                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-500/30 text-purple-200">
                                  🏬 Inside {bestSpot.associatedMall}
                                </span>
                              )}
                              <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                bestSpot.isInsidePolygon ? 'bg-emerald-500/30 text-emerald-300' : 'bg-amber-500/30 text-amber-300'
                              }`}>
                                {bestSpot.isInsidePolygon ? '✓ Inside Group Area' : '📍 Nearby Outside'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-slate-300 mt-1">📍 {bestSpot.address}</p>
                      </div>

                      {bestSpot.memberDistances && (
                        <div className="pt-2 border-t border-white/10 space-y-1">
                          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                            Straight-Line Distance per Member
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
                      <div className="flex justify-between items-center">
                        <h3 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400">
                          Recommended Places ({places.length})
                        </h3>
                        {isExpandedArea && (
                          <span className="text-[10px] text-amber-300 font-bold bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">
                            Area Expanded
                          </span>
                        )}
                      </div>

                      {isExpandedArea && (
                        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] flex items-start gap-2">
                          <Info className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                          <span>No attractions found strictly inside the polygon. Displaying verified spots from the surrounding area.</span>
                        </div>
                      )}

                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                        {places.map((place) => (
                          <div
                            key={place.id}
                            onClick={() => setSelectedPlace(place)}
                            style={{
                              backgroundColor: selectedPlace && selectedPlace.id === place.id ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                              borderColor: selectedPlace && selectedPlace.id === place.id ? 'rgba(129, 140, 248, 0.6)' : 'rgba(255, 255, 255, 0.1)'
                            }}
                            className="p-3 rounded-2xl border transition-all cursor-pointer space-y-2 hover:border-indigo-400/50"
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <span className="text-lg shrink-0 p-1.5 rounded-xl bg-white/10">{place.categoryIcon || '📍'}</span>
                                <div className="overflow-hidden">
                                  <h4 className="text-xs font-bold text-white truncate">{place.name}</h4>
                                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                    {place.category && (
                                      <span className="text-[10px] text-indigo-300/90 font-medium">
                                        {place.category}
                                      </span>
                                    )}
                                    {place.associatedMall && (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-200">
                                        🏬 Inside {place.associatedMall}
                                      </span>
                                    )}
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                                      place.isInsidePolygon
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                        : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                    }`}>
                                      {place.isInsidePolygon ? '✓ Inside Group Area' : '📍 Nearby Outside Group Area'}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 truncate mt-1">📍 {place.address}</p>
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

              {/* 2. PREDICT / SATELLITE AI SCANNER & SCROLLABLE SPOTS PANEL */}
              {activeTab === 'analysis' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-indigo-400" />
                      <h2 className="text-sm font-bold uppercase tracking-tighter text-white">Current Point Land-Use</h2>
                    </div>
                    {loading && (
                      <span className="text-[10px] text-indigo-300 font-mono flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Scanning...
                      </span>
                    )}
                  </div>

                  {/* Real-time confidence scores for scanned center */}
                  <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                    {prediction ? Object.entries(prediction.all_scores)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([name, score]) => (
                      <div key={name} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-300 font-medium">{TERRAIN_CONFIG[name]?.label || name}</span>
                          <span className="font-mono text-indigo-300 font-bold">{(score * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-900/60 rounded-full overflow-hidden border border-white/5">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${score * 100}%` }}
                            className="h-full shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                            style={{ backgroundColor: TERRAIN_CONFIG[name]?.color || '#6366f1' }}
                          />
                        </div>
                      </div>
                    )) : (
                      <div className="text-center py-6 text-slate-500 italic text-xs">
                        <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2" />
                        Scanning planetary satellite surface...
                      </div>
                    )}
                  </div>

                  {/* 📜 SCROLLABLE SPOTS / SCAN HISTORY PANEL */}
                  <div className="space-y-2 pt-2 border-t border-white/10">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400 flex items-center gap-1.5">
                        <Compass className="w-3.5 h-3.5" />
                        <span>Scanned Spots History ({scanHistory.length})</span>
                      </h3>
                      <span className="text-[10px] text-slate-400">Click to focus map</span>
                    </div>

                    {scanHistory.length === 0 ? (
                      <p className="text-xs text-slate-500 italic p-3 text-center bg-white/5 rounded-xl border border-white/5">
                        Pan the satellite map around to scan and log terrain spots.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
                        {scanHistory.map((spot) => {
                          const config = TERRAIN_CONFIG[spot.prediction] || {};
                          return (
                            <div
                              key={spot.id}
                              onClick={() => handleSpotClick(spot)}
                              className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-indigo-400/50 hover:bg-white/10 transition-all cursor-pointer flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 overflow-hidden">
                                <div 
                                  className="w-3 h-3 rounded-full shrink-0 shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                                  style={{ backgroundColor: config.color || '#818cf8' }}
                                />
                                <div className="overflow-hidden">
                                  <h4 className="text-xs font-bold text-white truncate">{config.label || spot.prediction}</h4>
                                  <p className="text-[10px] font-mono text-slate-400">
                                    {spot.lat.toFixed(4)}, {spot.lon.toFixed(4)} • {spot.timestamp}
                                  </p>
                                </div>
                              </div>
                              <span className="text-[11px] font-mono font-bold text-indigo-300 px-2 py-0.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 shrink-0">
                                {(spot.confidence * 100).toFixed(1)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* 3. ABOUT TAB CONTENT */}
              {activeTab === 'about' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
                   <div className="space-y-2">
                     <h2 className="text-base font-extrabold text-white">About Terrain AI & Connect</h2>
                     <p className="text-xs text-slate-300 leading-relaxed">
                       Terrain AI combines state-of-the-art satellite vision with intelligent group meeting planning.
                     </p>
                   </div>

                   {/* Connect Feature Deep-Dive */}
                   <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 space-y-2.5">
                     <h4 className="text-xs font-extrabold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                       <Users className="w-4 h-4 text-indigo-400" />
                       <span>Connect — Group Meeting Planner</span>
                     </h4>
                     <p className="text-[11px] text-slate-300 leading-relaxed">
                       Connect solves the common problem of organizing meetups across multiple friends in different parts of a city:
                     </p>
                     <ul className="text-[11px] text-slate-300 space-y-1.5 list-disc pl-4">
                       <li><strong>Convex Hull Boundary:</strong> Computes the exact geometric convex polygon surrounding all members.</li>
                       <li><strong>Inside vs. Nearby Filtering:</strong> Automatically identifies places within your group area and cleanly falls back to nearby surrounding spots.</li>
                       <li><strong>Centroid Fairness Ranking:</strong> Minimizes total travel distance and variance so no single person travels excessively far.</li>
                       <li><strong>9 Distinct Discovery Categories:</strong> Curated discovery for Shopping Malls, Multiplexes with mall links, Cafes, Restaurants, Famous Spots, Parks, Shopping, Attractions, and Entertainment.</li>
                       <li><strong>Standard 2D Street Maps:</strong> Built on crisp OpenStreetMap vector street tiles with street names, roads, and building labels.</li>
                     </ul>
                   </div>

                   {/* EuroSAT Model Info */}
                   <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                     <h4 className="text-xs font-extrabold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                       <Layers className="w-4 h-4" />
                       <span>Terrain AI Core Engine</span>
                     </h4>
                     <p className="text-[11px] text-slate-300 leading-relaxed">
                       Powered by a deep convolutional network trained on the EuroSAT dataset (Sentinel-2 satellite imagery). It distinguishes 10 land cover classes with high accuracy in real-time.
                     </p>
                   </div>
                </motion.div>
              )}

              {/* 4. CONTACT US TAB CONTENT (Updated Feedback Form) */}
              {activeTab === 'contact' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base sm:text-lg font-extrabold text-white">Help Us Improve Terrain AI</h2>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Found a UI issue or something that isn't working as expected? Share your feedback and help us improve the Terrain AI experience.
                    </p>
                  </div>

                  {/* Success Banner */}
                  {feedbackSuccess && (
                    <div className="p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{feedbackSuccess}</span>
                    </div>
                  )}

                  {/* Error Banner */}
                  {feedbackError && (
                    <div className="p-3.5 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <span>{feedbackError}</span>
                    </div>
                  )}

                  {/* Feedback Form */}
                  <form onSubmit={handleFeedbackSubmit} className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-widest text-slate-300 mb-1">
                        Your Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Aryan Ejantkar"
                        value={feedbackForm.name}
                        onChange={(e) => setFeedbackForm({ ...feedbackForm, name: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-400 transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-widest text-slate-300 mb-1">
                        Your Email
                      </label>
                      <input
                        type="email"
                        placeholder="e.g. name@example.com"
                        value={feedbackForm.email}
                        onChange={(e) => setFeedbackForm({ ...feedbackForm, email: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-400 transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-widest text-slate-300 mb-1">
                        Feedback Category
                      </label>
                      <select
                        value={feedbackForm.category}
                        onChange={(e) => setFeedbackForm({ ...feedbackForm, category: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/15 text-white text-xs focus:outline-none focus:border-indigo-400 transition-all"
                      >
                        {FEEDBACK_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat} className="bg-slate-900 text-white">
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-extrabold uppercase tracking-widest text-slate-300 mb-1">
                        Description / Feedback
                      </label>
                      <textarea
                        rows={4}
                        placeholder="Tell us what you noticed or what could be improved..."
                        value={feedbackForm.description}
                        onChange={(e) => setFeedbackForm({ ...feedbackForm, description: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-indigo-400 transition-all resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submittingFeedback}
                      className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-extrabold text-xs rounded-xl shadow-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                    >
                      {submittingFeedback ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Submitting...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          <span>Submit Feedback</span>
                        </>
                      )}
                    </button>
                  </form>
                </motion.div>
              )}
            </div>

            {error && activeTab === 'analysis' && (
              <div className="m-3 p-2.5 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-xs text-center font-bold">
                {error}
              </div>
            )}
          </motion.div>
        )}
      </div>
      )}

      {/* ROOT LEVEL ADD / EDIT PERSON MODAL */}
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
