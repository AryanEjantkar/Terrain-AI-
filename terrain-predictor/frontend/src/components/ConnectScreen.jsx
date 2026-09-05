import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Users, Search, AlertTriangle } from 'lucide-react';

import ConnectMap from './Connect/ConnectMap';
import PersonList from './Connect/PersonList';
import AddPersonModal from './Connect/AddPersonModal';
import PlaceSearch from './Connect/PlaceSearch';
import PlaceCard from './Connect/PlaceCard';
import MeetingSpotCard from './Connect/MeetingSpotCard';

import { getConvexHull } from '../utils/convexHull';
import { getBoundingBox } from '../utils/geoUtils';
import { filterPlacesInPolygon } from '../utils/pointInPolygon';
import { rankMeetingSpots } from '../utils/meetingSpot';
import { fetchPlacesInArea } from '../services/placesService';

export default function ConnectScreen() {
  // People state (stored in local state; initialized with user location if present)
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

  // Modal controls
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState(null);

  // Places and search state
  const [selectedCategory, setSelectedCategory] = useState('cafe');
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [bestSpot, setBestSpot] = useState(null);
  const [isExpandedArea, setIsExpandedArea] = useState(false);

  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Calculate Convex Hull dynamically whenever people array changes
  const hullPoints = useMemo(() => {
    if (!people || people.length < 3) return [];
    return getConvexHull(people);
  }, [people]);

  // Calculate bounding box of members/polygon
  const boundingBox = useMemo(() => {
    return getBoundingBox(people);
  }, [people]);

  // Handle adding or updating a person
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
    // Reset place search results on group change
    setPlaces([]);
    setBestSpot(null);
  };

  // Handle removing a person
  const handleRemovePerson = (personId) => {
    setPeople((prev) => prev.filter((p) => p.id !== personId));
    setPlaces([]);
    setBestSpot(null);
  };

  // Search Places inside the calculated group area
  const handleSearchPlaces = useCallback(async (catId = selectedCategory, customQuery = '') => {
    if (!boundingBox) {
      setSearchError('Please add at least one person location to search places.');
      return;
    }

    setLoadingPlaces(true);
    setSearchError(null);
    setSelectedPlace(null);

    try {
      const rawPlaces = await fetchPlacesInArea(boundingBox, catId, customQuery);

      if (!rawPlaces || rawPlaces.length === 0) {
        setSearchError('No places found in this immediate area. Try selecting another category or area.');
        setPlaces([]);
        setBestSpot(null);
        setLoadingPlaces(false);
        return;
      }

      // Filter places locally using Ray-Casting algorithm against Convex Hull polygon
      const { insidePlaces, isExpanded } = filterPlacesInPolygon(
        rawPlaces,
        hullPoints.length >= 3 ? hullPoints : people
      );

      setIsExpandedArea(isExpanded);

      // Rank candidate places for Best Meeting Spot calculation
      const { rankedPlaces, bestSpot: optimalSpot } = rankMeetingSpots(insidePlaces, people);

      setPlaces(rankedPlaces);
      setBestSpot(optimalSpot);
    } catch (err) {
      console.error('Place search error:', err);
      setSearchError(err.message || 'Failed to retrieve places. Please check network connection.');
    } finally {
      setLoadingPlaces(false);
    }
  }, [boundingBox, hullPoints, people, selectedCategory]);

  return (
    <div className="relative w-full h-full flex flex-col md:flex-row overflow-hidden bg-slate-950">
      
      {/* 2D Connect Street Map View */}
      <div className="w-full h-[45vh] md:h-full md:flex-1 relative z-0">
        <ConnectMap
          people={people}
          hullPoints={hullPoints}
          places={places}
          selectedPlace={selectedPlace}
          bestSpot={bestSpot}
          onSelectPlace={setSelectedPlace}
        />

        {/* Floating Area Boundary Badge */}
        <div className="absolute top-4 left-4 z-10 pointer-events-auto">
          <div className="glass px-3.5 py-2 rounded-2xl border border-white/10 flex items-center gap-2 shadow-lg">
            <Users className="w-4 h-4 text-indigo-400" />
            <div>
              <span className="text-xs font-bold text-white block">
                {people.length} {people.length === 1 ? 'Person' : 'People'} Connected
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {people.length >= 3
                  ? `Convex Hull Polygon Active (${hullPoints.length} Vertices)`
                  : 'Add 3+ people for polygon boundary'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Control Sidebar / Bottom Sheet */}
      <motion.div
        initial={{ x: 50, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="w-full md:w-[420px] h-[55vh] md:h-full glass border-t md:border-t-0 md:border-l border-white/10 pointer-events-auto flex flex-col z-10 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-400">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight text-white">CONNECT AREA</h2>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-extrabold">
                Group Boundary & POI Discovery
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable Content Container */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin">
          
          {/* 1. People Management Section */}
          <PersonList
            people={people}
            onOpenAddModal={() => {
              setEditingPerson(null);
              setIsAddModalOpen(true);
            }}
            onEditPerson={(p) => {
              setEditingPerson(p);
              setIsAddModalOpen(true);
            }}
            onRemovePerson={handleRemovePerson}
          />

          {/* 2. Place Search & Categories */}
          <div className="pt-4 border-t border-white/10">
            <PlaceSearch
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              onSearch={handleSearchPlaces}
              loading={loadingPlaces}
            />
          </div>

          {/* Error Message Alert */}
          {searchError && (
            <div className="p-3 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{searchError}</span>
            </div>
          )}

          {/* 3. ⭐ Best Meeting Spot Banner */}
          {bestSpot && (
            <div className="pt-2">
              <MeetingSpotCard
                bestSpot={bestSpot}
                onFindBestSpot={() => handleSearchPlaces()}
                onSelectSpot={setSelectedPlace}
                isExpandedArea={isExpandedArea}
                loading={loadingPlaces}
              />
            </div>
          )}

          {/* 4. Recommended Places List */}
          {places.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex justify-between items-center">
                <h3 className="text-xs uppercase font-extrabold tracking-widest text-indigo-400">
                  ⭐ Recommended Places ({places.length})
                </h3>
                {isExpandedArea && (
                  <span className="text-[10px] text-amber-400 font-medium">Area Expanded</span>
                )}
              </div>

              <div className="space-y-2.5">
                {places.map((place) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    isSelected={selectedPlace && selectedPlace.id === place.id}
                    isBest={bestSpot && bestSpot.id === place.id}
                    onSelectPlace={setSelectedPlace}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Add / Edit Person Modal */}
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
