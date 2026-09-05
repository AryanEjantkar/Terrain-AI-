import axios from 'axios';

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

export const PLACE_CATEGORIES = [
  { id: 'cafe', label: 'Cafes', icon: '☕', osmKey: 'amenity', osmVal: 'cafe' },
  { id: 'restaurant', label: 'Restaurants', icon: '🍽', osmKey: 'amenity', osmVal: 'restaurant' },
  { id: 'theatre', label: 'Theatres', icon: '🎬', osmKey: 'amenity', osmVal: 'cinema' },
  { id: 'park', label: 'Parks', icon: '🌳', osmKey: 'leisure', osmVal: 'park' },
  { id: 'famous', label: 'Famous Spots', icon: '📸', osmKey: 'tourism', osmVal: 'attraction' },
  { id: 'shopping', label: 'Shopping', icon: '🛍', osmKey: 'shop', osmVal: 'mall' },
  { id: 'tourist', label: 'Tourist Attractions', icon: '🏛', osmKey: 'tourism', osmVal: 'museum' },
  { id: 'hospital', label: 'Hospitals', icon: '🏥', osmKey: 'amenity', osmVal: 'hospital' }
];

/**
 * Fetches places of interest (POIs) within a bounding box.
 * 
 * @param {{minLat: number, minLng: number, maxLat: number, maxLng: number}} bbox 
 * @param {string} categoryId Category key or 'all'
 * @param {string} [searchQuery=''] Custom search query string
 * @returns {Promise<Array<{id: string, name: string, category: string, categoryIcon: string, lat: number, lng: number, address: string}>>}
 */
export async function fetchPlacesInArea(bbox, categoryId = 'cafe', searchQuery = '') {
  if (!bbox) {
    throw new Error('Valid area coordinates are required to search places.');
  }

  // Expand bounding box slightly (~1km padding) to ensure good candidate coverage around group edge
  const padding = 0.015;
  const s = bbox.minLat - padding;
  const w = bbox.minLng - padding;
  const n = bbox.maxLat + padding;
  const e = bbox.maxLng + padding;

  const categoryObj = PLACE_CATEGORIES.find(c => c.id === categoryId) || PLACE_CATEGORIES[0];

  // Try Overpass API first for structured POI search
  try {
    let overpassQuery = '';
    if (searchQuery && searchQuery.trim()) {
      // Named search within bbox
      overpassQuery = `[out:json][timeout:15];(node["name"~"${searchQuery.trim()}",i](${s},${w},${n},${e});way["name"~"${searchQuery.trim()}",i](${s},${w},${n},${e}););out center 25;`;
    } else {
      // Category search
      const k = categoryObj.osmKey;
      const v = categoryObj.osmVal;
      overpassQuery = `[out:json][timeout:15];(node["${k}"="${v}"](${s},${w},${n},${e});way["${k}"="${v}"](${s},${w},${n},${e});node["name"]("${k}"="${v}")(${s},${w},${n},${e}););out center 25;`;
    }

    const response = await axios.post(OVERPASS_API_URL, `data=${encodeURIComponent(overpassQuery)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    if (response.data && response.data.elements && response.data.elements.length > 0) {
      const places = response.data.elements
        .filter(el => el.tags && (el.tags.name || el.tags.amenity || el.tags.shop || el.tags.tourism))
        .map((el, idx) => {
          const lat = el.lat || (el.center && el.center.lat);
          const lng = el.lon || (el.center && el.center.lon);
          const name = el.tags.name || `${categoryObj.label} Spot #${idx + 1}`;
          const address = el.tags['addr:street']
            ? `${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}`
            : el.tags['addr:suburb'] || el.tags['addr:city'] || 'Nearby';

          return {
            id: `poi-${el.id || idx}`,
            name,
            category: categoryObj.label,
            categoryIcon: categoryObj.icon,
            lat,
            lng,
            address
          };
        })
        .filter(p => p.lat != null && p.lng != null);

      if (places.length > 0) return places;
    }
  } catch (err) {
    console.warn('Overpass API primary search failed/timed out, falling back to Nominatim POI search:', err.message);
  }

  // Fallback: Nominatim POI search within bounding box
  try {
    const q = searchQuery.trim() ? searchQuery.trim() : categoryObj.label;
    const response = await axios.get(NOMINATIM_SEARCH_URL, {
      params: {
        q,
        format: 'json',
        viewbox: `${w},${n},${e},${s}`,
        bounded: 1,
        limit: 20
      },
      headers: { 'Accept-Language': 'en-US,en' },
      timeout: 8000
    });

    if (response.data && response.data.length > 0) {
      return response.data.map((item, idx) => ({
        id: `nom-${item.place_id || idx}`,
        name: item.display_name.split(',')[0] || item.display_name,
        category: categoryObj.label,
        categoryIcon: categoryObj.icon,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        address: item.display_name.split(',').slice(1, 3).join(', ').trim() || 'Nearby'
      }));
    }
  } catch (err) {
    console.error('Nominatim POI search failed:', err.message);
  }

  return [];
}
