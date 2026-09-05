/**
 * Geographic utility functions for CONNECT feature.
 */

/**
 * Calculates the Haversine distance between two sets of lat/lng coordinates in kilometers.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in kilometers
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Formats a distance in kilometers to a human readable string (e.g. "1.4 km" or "850 m").
 * @param {number} kmDistance 
 * @returns {string} Formatted string
 */
export function formatDistance(kmDistance) {
  if (kmDistance == null || isNaN(kmDistance)) return '0 m';
  if (kmDistance < 1) {
    return `${Math.round(kmDistance * 1000)} m`;
  }
  return `${kmDistance.toFixed(1)} km`;
}

/**
 * Computes bounding box [minLat, minLng, maxLat, maxLng] for an array of coordinate objects {lat, lng}.
 * @param {Array<{lat: number, lng: number}>} points 
 * @returns {{minLat: number, minLng: number, maxLat: number, maxLng: number} | null}
 */
export function getBoundingBox(points) {
  if (!points || points.length === 0) return null;

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }

  return { minLat, minLng, maxLat, maxLng };
}

/**
 * Generates external Google Maps directions link for a given lat/lng.
 * @param {number} lat 
 * @param {number} lng 
 * @param {string} [placeName] 
 * @returns {string} Navigation URL
 */
export function getGoogleMapsDirectionsUrl(lat, lng, placeName = '') {
  const destination = encodeURIComponent(placeName ? `${placeName}` : `${lat},${lng}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}
