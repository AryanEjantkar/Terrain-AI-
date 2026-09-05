import { calculateHaversineDistance } from './geoUtils.js';

/**
 * Checks whether a target point ({lat, lng}) lies inside a polygon ({lat, lng}[])
 * using the Ray-Casting algorithm.
 * 
 * @param {{lat: number, lng: number}} point 
 * @param {Array<{lat: number, lng: number}>} polygon 
 * @param {number} [bufferKm=0.5] Fallback buffer radius if polygon has fewer than 3 vertices
 * @returns {boolean} True if point is inside polygon or within fallback buffer
 */
export function isPointInPolygon(point, polygon, bufferKm = 0.5) {
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
 * Filters an array of place items by checking if their coordinates lie within the polygon.
 * If filtering yields 0 places, returns candidates within an expanded radius so the user still gets results.
 * 
 * @param {Array<Object>} places Array of place objects with lat & lng properties
 * @param {Array<{lat: number, lng: number}>} polygon Convex Hull polygon
 * @returns {{ insidePlaces: Array<Object>, isExpanded: boolean }}
 */
export function filterPlacesInPolygon(places, polygon) {
  if (!places || places.length === 0) return { insidePlaces: [], isExpanded: false };
  if (!polygon || polygon.length === 0) return { insidePlaces: places, isExpanded: false };

  const strictlyInside = places.filter(place => isPointInPolygon({ lat: place.lat, lng: place.lng }, polygon));

  if (strictlyInside.length > 0) {
    return { insidePlaces: strictlyInside, isExpanded: false };
  }

  // If no places fall strictly inside (e.g. tight polygon), include places near the boundary polygon
  return { insidePlaces: places, isExpanded: true };
}
