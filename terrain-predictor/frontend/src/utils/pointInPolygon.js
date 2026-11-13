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
 * Filters and tags place items by determining if they lie strictly inside the polygon or nearby outside.
 * Prioritizes places inside the group's polygon while retaining nearby options so results are never lost.
 * 
 * @param {Array<Object>} places Array of place objects with lat & lng properties
 * @param {Array<{lat: number, lng: number}>} polygon Convex Hull polygon
 * @returns {{ insidePlaces: Array<Object>, isExpanded: boolean, insideCount: number, outsideCount: number }}
 */
export function filterPlacesInPolygon(places, polygon) {
  if (!places || places.length === 0) {
    return { insidePlaces: [], isExpanded: false, insideCount: 0, outsideCount: 0 };
  }

  const strictlyInside = [];
  const nearbyOutside = [];

  for (const place of places) {
    const isInside = isPointInPolygon({ lat: place.lat, lng: place.lng }, polygon);
    const taggedPlace = {
      ...place,
      isInsidePolygon: isInside,
      areaStatus: isInside ? 'Inside Group Area' : 'Nearby Outside Group Area'
    };

    if (isInside) {
      strictlyInside.push(taggedPlace);
    } else {
      nearbyOutside.push(taggedPlace);
    }
  }

  // Prioritize places inside the polygon first, followed by nearby outside places
  const combinedPlaces = [...strictlyInside, ...nearbyOutside];
  const isExpanded = strictlyInside.length === 0;

  return {
    insidePlaces: combinedPlaces,
    isExpanded,
    insideCount: strictlyInside.length,
    outsideCount: nearbyOutside.length
  };
}
