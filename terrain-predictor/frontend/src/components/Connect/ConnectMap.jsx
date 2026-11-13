import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';

// Create clean SVG DivIcons for Leaflet markers
const createCustomMarkerIcon = (label, isUser = false, isSelected = false) => {
  const bgColor = isUser ? '#6366f1' : isSelected ? '#f59e0b' : '#3b82f6';
  const borderColor = isUser ? '#a5b4fc' : isSelected ? '#fde68a' : '#93c5fd';
  
  const html = `
    <div style="
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(15, 23, 42, 0.85);
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
      <div style="
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background-color: ${bgColor};
        box-shadow: 0 0 8px ${bgColor};
      "></div>
      <span>${label}</span>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-leaflet-pin',
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
};

const createPlaceMarkerIcon = (categoryIcon, isSelected = false, isBest = false) => {
  const bg = isBest ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : isSelected ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(30, 41, 59, 0.9)';
  const border = isBest ? '#fbbf24' : isSelected ? '#a5b4fc' : 'rgba(255,255,255,0.2)';
  const scale = isSelected || isBest ? 'scale(1.2)' : 'scale(1)';

  const html = `
    <div style="
      width: 32px;
      height: 32px;
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

  return L.divIcon({
    html,
    className: 'custom-place-pin',
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
};

// Component to dynamically adjust map bounds when people or places change
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
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: true });
      }
    }
  }, [map, people, hullPoints, selectedPlace]);

  return null;
};

export default function ConnectMap({
  people,
  hullPoints,
  places = [],
  selectedPlace = null,
  bestSpot = null,
  onSelectPlace,
  userLocation
}) {
  // Default map center (User location or first person or Paris)
  const defaultCenter = userLocation
    ? [userLocation.lat, userLocation.lng]
    : people && people.length > 0
    ? [people[0].lat, people[0].lng]
    : [17.3850, 78.4867]; // Default Hyderabad

  // Format polygon coordinates array for React Leaflet [[lat, lng], ...]
  const polygonCoords = (hullPoints && hullPoints.length >= 3)
    ? hullPoints.map(p => [p.lat, p.lng])
    : [];

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        zoomControl={true}
        className="w-full h-full"
      >
        {/* 2D OpenStreetMap Tile Layer as required */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        <MapBoundsAdjuster people={people} hullPoints={hullPoints} selectedPlace={selectedPlace} />

        {/* Convex Hull Boundary Polygon */}
        {polygonCoords.length >= 3 && (
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

        {/* People Markers */}
        {people.map((person, idx) => (
          <Marker
            key={person.id || `person-${idx}`}
            position={[person.lat, person.lng]}
            icon={createCustomMarkerIcon(person.isUser ? `${person.name} (You)` : person.name, person.isUser, false)}
          >
            <Popup className="custom-leaflet-popup">
              <div className="p-1">
                <p className="font-bold text-sm text-slate-800">{person.name}</p>
                <p className="text-xs text-slate-600">{person.address || 'Saved Location'}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Places / POI Markers */}
        {places.map((place) => {
          const isSelected = selectedPlace && selectedPlace.id === place.id;
          const isBest = bestSpot && bestSpot.id === place.id;

          return (
            <Marker
              key={place.id}
              position={[place.lat, place.lng]}
              icon={createPlaceMarkerIcon(place.categoryIcon, isSelected, isBest)}
              eventHandlers={{
                click: () => onSelectPlace && onSelectPlace(place)
              }}
            >
              <Popup>
                <div className="p-1">
                  <div className="flex items-center gap-1">
                    <span>{place.categoryIcon}</span>
                    <strong className="text-sm">{place.name}</strong>
                  </div>
                  {place.category && <p className="text-[11px] text-indigo-600 font-semibold">{place.category}</p>}
                  {place.associatedMall && <p className="text-[10px] text-purple-700 font-semibold mt-0.5">🏬 Inside {place.associatedMall}</p>}
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full inline-block mt-1 ${
                    place.isInsidePolygon ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {place.isInsidePolygon ? '✓ Inside Group Area' : '📍 Nearby Outside Group Area'}
                  </span>
                  {isBest && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 block mt-1">
                      ⭐ Best Meeting Spot
                    </span>
                  )}
                  <p className="text-xs text-slate-500 mt-1">{place.address}</p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
