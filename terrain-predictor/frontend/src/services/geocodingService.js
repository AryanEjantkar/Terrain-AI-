import axios from 'axios';

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/';

const APP_HEADERS = {
  'User-Agent': 'TerrainAI-Planner/1.0 (https://github.com/AryanEjantkar/Terrain-AI-; terrainai@connect.org)',
  'Accept-Language': 'en-US,en'
};

/**
 * Geocodes an address string to latitude/longitude coordinates with multi-stage fallback.
 * Supports colloquial Indian locality names (e.g. "Alkapuri, Nagole" -> "Alkapuri, Hyderabad").
 * 
 * @param {string} addressQuery 
 * @param {number} [biasLat] Optional reference latitude
 * @param {number} [biasLng] Optional reference longitude
 * @returns {Promise<{lat: number, lng: number, displayName: string}>}
 */
export async function geocodeAddress(addressQuery, biasLat = 17.3850, biasLng = 78.4867) {
  if (!addressQuery || !addressQuery.trim()) {
    throw new Error('Please enter a valid address.');
  }

  const cleanQuery = addressQuery.trim();
  console.log(`[GEOCODING PIPELINE] 1. Starting geocoding for query: "${cleanQuery}"`);

  // Stage 1: Nominatim exact match
  try {
    const response = await axios.get(NOMINATIM_SEARCH_URL, {
      params: {
        q: cleanQuery,
        format: 'json',
        addressdetails: 1,
        limit: 1
      },
      headers: APP_HEADERS,
      timeout: 7000
    });

    if (response.data && response.data.length > 0) {
      const match = response.data[0];
      const lat = parseFloat(match.lat);
      const lng = parseFloat(match.lon);
      if (!isNaN(lat) && !isNaN(lng)) {
        console.log(`[GEOCODING PIPELINE] Stage 1 (Nominatim exact) succeeded: (${lat}, ${lng}) - ${match.display_name}`);
        return {
          lat,
          lng,
          displayName: match.display_name || cleanQuery
        };
      }
    }
  } catch (err) {
    console.warn(`[GEOCODING PIPELINE] Stage 1 failed or rate-limited:`, err.message);
  }

  // Stage 2: Tokenized / Comma-separated component fallback (e.g. "Alkapuri, Nagole" -> "Alkapuri Hyderabad")
  const parts = cleanQuery.split(',').map(p => p.trim()).filter(Boolean);
  const candidateQueries = [];
  
  if (parts.length > 1) {
    candidateQueries.push(`${parts[0]} Hyderabad`);
    candidateQueries.push(parts[0]);
    candidateQueries.push(`${parts[1]} Hyderabad`);
    candidateQueries.push(parts[1]);
  } else if (!cleanQuery.toLowerCase().includes('hyderabad')) {
    candidateQueries.push(`${cleanQuery} Hyderabad`);
  }

  for (const candidate of candidateQueries) {
    try {
      console.log(`[GEOCODING PIPELINE] Stage 2 fallback trying: "${candidate}"`);
      const response = await axios.get(NOMINATIM_SEARCH_URL, {
        params: {
          q: candidate,
          format: 'json',
          addressdetails: 1,
          limit: 1
        },
        headers: APP_HEADERS,
        timeout: 5000
      });

      if (response.data && response.data.length > 0) {
        const match = response.data[0];
        const lat = parseFloat(match.lat);
        const lng = parseFloat(match.lon);
        if (!isNaN(lat) && !isNaN(lng)) {
          console.log(`[GEOCODING PIPELINE] Stage 2 (Nominatim component) succeeded for "${candidate}": (${lat}, ${lng}) - ${match.display_name}`);
          return {
            lat,
            lng,
            displayName: `${cleanQuery} (${match.display_name.split(',')[0]})`
          };
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  // Stage 3: Photon Komoot API fallback (fast, resilient, handles fuzzy locality queries)
  try {
    const photonQueries = parts.length > 1 ? [parts[0], cleanQuery] : [cleanQuery];
    for (const pq of photonQueries) {
      console.log(`[GEOCODING PIPELINE] Stage 3 (Photon API) trying: "${pq}"`);
      const photonResp = await axios.get(PHOTON_SEARCH_URL, {
        params: {
          q: pq,
          lat: biasLat,
          lon: biasLng,
          limit: 1
        },
        headers: APP_HEADERS,
        timeout: 5000
      });

      if (photonResp.data && photonResp.data.features && photonResp.data.features.length > 0) {
        const feat = photonResp.data.features[0];
        const [lon, lat] = feat.geometry.coordinates;
        const name = feat.properties.name || feat.properties.street || cleanQuery;
        console.log(`[GEOCODING PIPELINE] Stage 3 (Photon API) succeeded: (${lat}, ${lon}) - ${name}`);
        return {
          lat: parseFloat(lat),
          lng: parseFloat(lon),
          displayName: `${cleanQuery} (${name})`
        };
      }
    }
  } catch (err) {
    console.warn(`[GEOCODING PIPELINE] Stage 3 (Photon API) failed:`, err.message);
  }

  throw new Error(`No coordinates found for "${cleanQuery}". Please check the spelling or try entering a nearby landmark.`);
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
