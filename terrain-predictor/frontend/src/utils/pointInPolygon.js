import { calculateHaversineDistance } from './geoUtils.js';

/**
 * Checks whether a target point ({lat, lng}) lies inside a polygon ({lat, lng}[])
 * using the Ray-Casting algorithm.
 * 
 * @param {{lat: number, lng: number}} point 
 * @param {Array<{lat: number, lng: number}>} polygon 
 * @param {number} [bufferKm=1.5] Fallback buffer radius if polygon has fewer than 3 vertices
 * @returns {boolean} True if point is inside polygon or within fallback buffer
 */
export function isPointInPolygon(point, polygon, bufferKm = 1.5) {
  if (!point || point.lat == null || point.lng == null) return false;
  if (!polygon || polygon.length === 0) return false;

  // Fallback for 1 or 2 point "polygons" (single person or 2 people line segment)
  if (polygon.length < 3) {
    return polygon.some(p => calculateHaversineDistance(point.lat, point.lng, p.lat, p.lng) <= bufferKm);
  }

  const x = point.lng;
  const y = point.lat;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Filters and categorizes place items into three distinct result groups:
 * 1. INSIDE GROUP AREA: Places located strictly inside the Convex Hull polygon.
 * 2. NEARBY OUTSIDE GROUP AREA: Places outside the polygon within an expanded surrounding buffer (~8km).
 * 3. POPULAR DESTINATIONS: High-profile regional multiplexes, malls, or landmarks in the broader area.
 * 
 * @param {Array<Object>} places Array of place objects with lat & lng properties
 * @param {Array<{lat: number, lng: number}>} polygon Convex Hull polygon
 * @returns {{
 *   insidePlaces: Array<Object>,
 *   nearbyPlaces: Array<Object>,
 *   popularPlaces: Array<Object>,
 *   allPlaces: Array<Object>,
 *   isExpanded: boolean,
 *   insideCount: number,
 *   nearbyCount: number,
 *   popularCount: number
 * }}
 */
export function filterPlacesInPolygon(places, polygon) {
  if (!places || places.length === 0) {
    return {
      insidePlaces: [],
      nearbyPlaces: [],
      popularPlaces: [],
      allPlaces: [],
      isExpanded: false,
      insideCount: 0,
      nearbyCount: 0,
      popularCount: 0
    };
  }

  // Calculate polygon centroid and bounding radius
  let centerLat = 0;
  let centerLng = 0;
  const polyPoints = polygon && polygon.length > 0 ? polygon : [{ lat: 17.3850, lng: 78.4867 }];

  polyPoints.forEach(p => {
    centerLat += p.lat;
    centerLng += p.lng;
  });
  centerLat /= polyPoints.length;
  centerLng /= polyPoints.length;

  let maxPolyRadiusKm = 0;
  polyPoints.forEach(p => {
    const d = calculateHaversineDistance(centerLat, centerLng, p.lat, p.lng);
    if (d > maxPolyRadiusKm) maxPolyRadiusKm = d;
  });

  const nearbyBufferKm = Math.max(7.5, maxPolyRadiusKm * 0.75);

  const insidePlaces = [];
  const nearbyPlaces = [];
  const popularPlaces = [];

  console.log(`[POLYGON PIPELINE] Filtering ${places.length} places against polygon with ${polyPoints.length} vertices. Centroid: (${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}), Radius: ${maxPolyRadiusKm.toFixed(2)}km`);

  for (const place of places) {
    if (place.lat == null || place.lng == null) continue;

    const isInside = isPointInPolygon({ lat: place.lat, lng: place.lng }, polygon);
    
    // Calculate distance to closest vertex and to centroid
    let minVertexDistKm = Infinity;
    polyPoints.forEach(v => {
      const d = calculateHaversineDistance(v.lat, v.lng, place.lat, place.lng);
      if (d < minVertexDistKm) minVertexDistKm = d;
    });
    const distToCenterKm = calculateHaversineDistance(centerLat, centerLng, place.lat, place.lng);

    let groupTier = 'inside';
    let groupTierLabel = 'Inside Group Area';
    let areaStatus = 'Inside Group Area';

    if (isInside) {
      groupTier = 'inside';
      groupTierLabel = 'Inside Group Area';
      areaStatus = 'Inside Group Area';
    } else if (minVertexDistKm <= nearbyBufferKm || distToCenterKm <= (maxPolyRadiusKm + 6.0)) {
      groupTier = 'nearby';
      groupTierLabel = 'Nearby Outside Group Area';
      areaStatus = 'Nearby Outside Group Area';
    } else {
      groupTier = 'popular';
      groupTierLabel = 'Popular Regional Destination';
      areaStatus = 'Popular Regional Destination';
    }

    const taggedPlace = {
      ...place,
      isInsidePolygon: isInside,
      groupTier,
      groupTierLabel,
      areaStatus,
      distToCenterKm,
      minVertexDistKm
    };

    if (groupTier === 'inside') {
      insidePlaces.push(taggedPlace);
    } else if (groupTier === 'nearby') {
      nearbyPlaces.push(taggedPlace);
    } else {
      popularPlaces.push(taggedPlace);
    }
  }

  console.log(`[POLYGON PIPELINE] Categorization results: Inside=${insidePlaces.length}, Nearby=${nearbyPlaces.length}, Popular=${popularPlaces.length}`);

  // Display priority: Inside first, then Nearby, then Popular
  const allPlaces = [...insidePlaces, ...nearbyPlaces, ...popularPlaces];
  const isExpanded = insidePlaces.length === 0;

  return {
    insidePlaces,
    nearbyPlaces,
    popularPlaces,
    allPlaces,
    isExpanded,
    insideCount: insidePlaces.length,
    nearbyCount: nearbyPlaces.length,
    popularCount: popularPlaces.length
  };
}
