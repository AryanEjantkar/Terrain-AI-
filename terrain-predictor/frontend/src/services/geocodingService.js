import axios from 'axios';

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

const APP_HEADERS = {
  'User-Agent': 'TerrainAI-Planner/1.0 (https://github.com/AryanEjantkar/Terrain-AI-; terrainai@connect.org)',
  'Accept-Language': 'en-US,en'
};

/**
 * Geocodes an address string to latitude/longitude coordinates.
 * 
 * @param {string} addressQuery 
 * @returns {Promise<{lat: number, lng: number, displayName: string}>}
 */
export async function geocodeAddress(addressQuery) {
  if (!addressQuery || !addressQuery.trim()) {
    throw new Error('Please enter a valid address.');
  }

  try {
    const response = await axios.get(NOMINATIM_SEARCH_URL, {
      params: {
        q: addressQuery,
        format: 'json',
        addressdetails: 1,
        limit: 1
      },
      headers: APP_HEADERS,
      timeout: 8000
    });

    if (!response.data || response.data.length === 0) {
      throw new Error(`No coordinates found for "${addressQuery}". Please try a more specific address.`);
    }

    const firstMatch = response.data[0];
    const lat = parseFloat(firstMatch.lat);
    const lng = parseFloat(firstMatch.lon);

    if (isNaN(lat) || isNaN(lng)) {
      throw new Error('Invalid coordinates returned from geocoding service.');
    }

    return {
      lat,
      lng,
      displayName: firstMatch.display_name || addressQuery
    };
  } catch (err) {
    if (err.response && err.response.status === 429) {
      throw new Error('Geocoding rate limit reached. Please wait a moment and try again.');
    }
    throw new Error(err.message || 'Geocoding service unavailable.');
  }
}

/**
 * Reverse geocodes lat/lng coordinates to a readable place/address name.
 * 
 * @param {number} lat 
 * @param {number} lng 
 * @returns {Promise<string>} Readable place name
 */
export async function reverseGeocode(lat, lng) {
  try {
    const response = await axios.get(NOMINATIM_REVERSE_URL, {
      params: {
        lat,
        lon: lng,
        format: 'json',
        zoom: 14
      },
      headers: APP_HEADERS,
      timeout: 6000
    });

    if (response.data && response.data.display_name) {
      const parts = response.data.display_name.split(',');
      // Shorten long address to key neighborhood / city part
      return parts.slice(0, 3).join(', ').trim();
    }
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}
