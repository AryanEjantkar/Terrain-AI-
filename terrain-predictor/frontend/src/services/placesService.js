import axios from 'axios';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
];

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const WIKIPEDIA_GEOSEARCH_URL = 'https://en.wikipedia.org/w/api.php';

const APP_HEADERS = {
  'User-Agent': 'TerrainAI-Planner/1.0 (https://github.com/AryanEjantkar/Terrain-AI-; terrainai@connect.org)',
  'Accept-Language': 'en-US,en'
};

// In-memory query cache with 5-minute TTL
const placesCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheKey(categoryId, bbox, query) {
  const minLat = bbox.minLat != null ? bbox.minLat.toFixed(3) : '0';
  const minLng = bbox.minLng != null ? bbox.minLng.toFixed(3) : '0';
  const maxLat = bbox.maxLat != null ? bbox.maxLat.toFixed(3) : '0';
  const maxLng = bbox.maxLng != null ? bbox.maxLng.toFixed(3) : '0';
  return `${categoryId}_${minLat}_${minLng}_${maxLat}_${maxLng}_${(query || '').trim().toLowerCase()}`;
}

export const PLACE_CATEGORIES = [
  { id: 'malls', label: 'Shopping Malls', icon: '🏬', defaultQuery: 'shopping mall' },
  { id: 'restaurant', label: 'Restaurants', icon: '🍽️', defaultQuery: 'restaurant' },
  { id: 'cafe', label: 'Cafes', icon: '☕', defaultQuery: 'cafe' },
  { id: 'cinemas', label: 'Cinemas / Multiplexes', icon: '🎬', defaultQuery: 'multiplex cinema' },
  { id: 'famous', label: 'Famous Spots', icon: '📸', defaultQuery: 'attraction' },
  { id: 'park', label: 'Parks', icon: '🌳', defaultQuery: 'park' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️', defaultQuery: 'shopping market' },
  { id: 'tourist', label: 'Tourist Attractions', icon: '🏛️', defaultQuery: 'tourist attraction' },
  { id: 'entertainment', label: 'Entertainment Centres', icon: '🎯', defaultQuery: 'gaming bowling entertainment' }
];

/**
 * Calculates straight-line distance in kilometers using the Haversine formula.
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Deduplicate places by name and proximity (< 120m).
 */
function deduplicatePlaces(places) {
  const result = [];
  for (const place of places) {
    if (!place.name || place.lat == null || place.lng == null) continue;
    const nameClean = place.name.trim().toLowerCase();

    const existing = result.find(p => {
      const pName = p.name.trim().toLowerCase();
      if (pName === nameClean) return true;
      if (pName.includes(nameClean) || nameClean.includes(pName)) {
        return calculateDistanceKm(p.lat, p.lng, place.lat, place.lng) < 0.25;
      }
      return calculateDistanceKm(p.lat, p.lng, place.lat, place.lng) < 0.12;
    });

    if (existing) {
      if (!existing.associatedMall && place.associatedMall) {
        existing.associatedMall = place.associatedMall;
      }
      if (!existing.cinemaChain && place.cinemaChain) {
        existing.cinemaChain = place.cinemaChain;
      }
      if (nameClean.includes('imax') && !existing.name.toLowerCase().includes('imax')) {
        existing.name = `${existing.name} (IMAX)`;
      }
      continue;
    }

    result.push(place);
  }
  return result;
}

/**
 * Extracts cinema chain and associated shopping mall name.
 */
function enrichCinemaData(name, address = '', tags = {}) {
  const n = (name || '').toLowerCase();
  let cinemaChain = 'Multiplex';
  if (n.includes('pvr')) cinemaChain = 'PVR Cinemas';
  else if (n.includes('inox')) cinemaChain = 'INOX';
  else if (n.includes('cinepolis')) cinemaChain = 'Cinépolis';
  else if (n.includes('imax')) cinemaChain = 'IMAX';
  else if (n.includes('miraj')) cinemaChain = 'Miraj Cinemas';
  else if (n.includes('prasads')) cinemaChain = 'Prasads Multiplex';
  else if (n.includes('carnival')) cinemaChain = 'Carnival Cinemas';
  else if (n.includes('moviemax')) cinemaChain = 'MovieMax';
  else if (n.includes('asian')) cinemaChain = 'Asian Cinemas';

  let associatedMall = null;

  // 1. Tag based
  if (tags['addr:place'] && tags['addr:place'].toLowerCase().includes('mall')) {
    associatedMall = tags['addr:place'];
  }

  // 2. Name based patterns like "PVR Cinemas, Inorbit Mall" or "INOX: GVK One" or "PVR (Next Galleria)"
  if (!associatedMall) {
    const patterns = [
      /(?:at|in|,|-|@|:|\()\s*([A-Za-z0-9\s&'-]+(?:Mall|Plaza|Centre|Center|Galleria|Forum|City|One|Square))/i,
      /([A-Za-z0-9\s&'-]+(?:Mall|Plaza|Centre|Center|Galleria|Forum|City|One|Square))/i
    ];
    for (const p of patterns) {
      const match = name.match(p);
      if (match && match[1]) {
        const candidate = match[1].trim();
        const candLower = candidate.toLowerCase();
        if (!candLower.includes('cinema') && !candLower.includes('multiplex') && !candLower.includes('theatre') && !candLower.includes('theater')) {
          associatedMall = candidate;
          break;
        }
      }
    }
  }

  // 3. Address based pattern
  if (!associatedMall && address) {
    const match = address.match(/([A-Za-z0-9\s&'-]+(?:Mall|Plaza|Centre|Center|Galleria|Forum|City|One))/i);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const candLower = candidate.toLowerCase();
      if (!candLower.includes('cinema') && !candLower.includes('multiplex')) {
        associatedMall = candidate;
      }
    }
  }

  return { cinemaChain, associatedMall };
}

/**
 * Filter out retail clothing/boutiques/grocery stores from actual shopping malls.
 */
function isGenuineMall(name = '', tags = {}) {
  const nameLower = name.toLowerCase();
  const shop = (tags.shop || '').toLowerCase();
  const amenity = (tags.amenity || '').toLowerCase();

  // Exclude standalone food courts
  if (nameLower.includes('food court') || nameLower.includes('foodcourt') || amenity === 'food_court') {
    return false;
  }

  // Exclude individual shops
  const rejectedShops = [
    'clothes', 'boutique', 'shoes', 'tailor', 'optician', 'chemist', 'pharmacy',
    'jewelry', 'jewellery', 'hairdresser', 'beauty', 'convenience', 'greengrocer',
    'butcher', 'stationery', 'mobile_phone', 'electronics'
  ];
  if (rejectedShops.includes(shop) && !nameLower.includes('mall') && !nameLower.includes('complex')) {
    return false;
  }

  const rejectedKeywords = [
    'saree', 'textiles', 'jewellers', 'jewellery', 'menswear', 'footwear',
    'tailors', 'sweet house', 'medical store', 'supermarket', 'hypermarket',
    'garments', 'handloom', 'opticals'
  ];
  if (rejectedKeywords.some(k => nameLower.includes(k)) && !nameLower.includes('mall')) {
    return false;
  }

  // Explicit mall tags
  if (shop === 'mall' || tags.building === 'mall') return true;

  // Commercial center / mall keywords
  if (
    nameLower.includes('mall') ||
    nameLower.includes('shopping centre') ||
    nameLower.includes('shopping center') ||
    nameLower.includes('shopping complex') ||
    nameLower.includes('commercial complex') ||
    nameLower.includes('galleria') ||
    nameLower.includes('city centre') ||
    nameLower.includes('city center')
  ) {
    return true;
  }

  return false;
}

/**
 * Discovers shopping malls and large shopping complexes.
 */
async function fetchShoppingMalls(bbox, searchQuery = '') {
  const padding = 0.05;
  const s = bbox.minLat - padding;
  const w = bbox.minLng - padding;
  const n = bbox.maxLat + padding;
  const e = bbox.maxLng + padding;

  const places = [];

  // 1. Overpass API for shop=mall and building=mall
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const q = searchQuery && searchQuery.trim()
        ? `[out:json][timeout:8];(nwr["shop"="mall"]["name"~"${searchQuery.trim()}",i](${s},${w},${n},${e});nwr["name"~"${searchQuery.trim()} Mall",i](${s},${w},${n},${e}););out center 25;`
        : `[out:json][timeout:8];(nwr["shop"="mall"](${s},${w},${n},${e});nwr["building"="mall"](${s},${w},${n},${e});nwr["amenity"="marketplace"]["name"~"Mall|Plaza|Centre|Center",i](${s},${w},${n},${e}););out center 25;`;

      const response = await axios.post(endpoint, `data=${encodeURIComponent(q)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 6000
      });

      if (response.data && response.data.elements && response.data.elements.length > 0) {
        for (const el of response.data.elements) {
          const lat = el.lat || (el.center && el.center.lat);
          const lng = el.lon || (el.center && el.center.lon);
          const tags = el.tags || {};
          const name = tags.name || tags['name:en'];
          if (!name || lat == null || lng == null) continue;

          if (isGenuineMall(name, tags)) {
            places.push({
              id: `osm-mall-${el.id}`,
              name,
              category: 'Shopping Mall',
              categoryIcon: '🏬',
              lat,
              lng,
              address: tags['addr:street'] ? `${tags['addr:street']}, ${tags['addr:city'] || ''}` : tags['addr:suburb'] || 'Shopping Complex',
              source: 'OpenStreetMap'
            });
          }
        }
        if (places.length > 0) break;
      }
    } catch {
      // Continue to next mirror
    }
  }

  // 2. Nominatim fallback for malls
  if (places.length < 8) {
    const nomQueries = searchQuery && searchQuery.trim()
      ? [searchQuery.trim()]
      : ['shopping mall', 'mall'];

    for (const term of nomQueries) {
      try {
        const resp = await axios.get(NOMINATIM_SEARCH_URL, {
          params: {
            q: term,
            format: 'json',
            viewbox: `${w},${n},${e},${s}`,
            bounded: 1,
            limit: 12,
            addressdetails: 1
          },
          headers: APP_HEADERS,
          timeout: 5000
        });

        if (resp.data && Array.isArray(resp.data)) {
          for (const item of resp.data) {
            const name = item.display_name.split(',')[0].trim();
            if (isGenuineMall(name, { shop: item.type })) {
              places.push({
                id: `nom-mall-${item.place_id}`,
                name,
                category: 'Shopping Mall',
                categoryIcon: '🏬',
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                address: item.display_name.split(',').slice(1, 3).join(', ').trim() || 'Shopping Complex',
                source: 'Nominatim'
              });
            }
          }
        }
      } catch {
        // Continue
      }
    }
  }

  return deduplicatePlaces(places);
}

/**
 * Discovers cinema halls and multiplexes, associates with malls, excludes open-air/amphitheatres.
 */
async function fetchCinemas(bbox, searchQuery = '') {
  const padding = 0.05;
  const s = bbox.minLat - padding;
  const w = bbox.minLng - padding;
  const n = bbox.maxLat + padding;
  const e = bbox.maxLng + padding;

  const places = [];

  // 1. Overpass API for amenity=cinema
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const q = searchQuery && searchQuery.trim()
        ? `[out:json][timeout:8];(nwr["amenity"="cinema"]["name"~"${searchQuery.trim()}",i](${s},${w},${n},${e}););out center 25;`
        : `[out:json][timeout:8];(nwr["amenity"="cinema"](${s},${w},${n},${e}););out center 25;`;

      const response = await axios.post(endpoint, `data=${encodeURIComponent(q)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 6000
      });

      if (response.data && response.data.elements && response.data.elements.length > 0) {
        for (const el of response.data.elements) {
          const lat = el.lat || (el.center && el.center.lat);
          const lng = el.lon || (el.center && el.center.lon);
          const tags = el.tags || {};
          const name = tags.name || tags['name:en'];
          if (!name || lat == null || lng == null) continue;

          // Exclude amphitheatres and open-air venues
          const nameLower = name.toLowerCase();
          if (
            tags.leisure === 'amphitheatre' ||
            tags.theater_type === 'open_air' ||
            tags.open_air === 'yes' ||
            nameLower.includes('amphitheatre') ||
            nameLower.includes('open air') ||
            nameLower.includes('drive-in')
          ) {
            continue;
          }

          const address = tags['addr:street'] ? `${tags['addr:street']}, ${tags['addr:city'] || ''}` : tags['addr:suburb'] || 'Multiplex';
          const { cinemaChain, associatedMall } = enrichCinemaData(name, address, tags);

          places.push({
            id: `osm-cinema-${el.id}`,
            name,
            category: 'Cinema / Multiplex',
            categoryIcon: '🎬',
            cinemaChain,
            associatedMall,
            lat,
            lng,
            address,
            source: 'OpenStreetMap'
          });
        }
        if (places.length > 0) break;
      }
    } catch {
      // Continue to next mirror
    }
  }

  // 2. Nominatim fallback for multiplexes and cinema chains
  if (places.length < 8) {
    const terms = searchQuery && searchQuery.trim()
      ? [searchQuery.trim()]
      : ['multiplex', 'cinema', 'PVR', 'INOX'];

    for (const term of terms) {
      try {
        const resp = await axios.get(NOMINATIM_SEARCH_URL, {
          params: {
            q: term,
            format: 'json',
            viewbox: `${w},${n},${e},${s}`,
            bounded: 1,
            limit: 12,
            addressdetails: 1
          },
          headers: APP_HEADERS,
          timeout: 5000
        });

        if (resp.data && Array.isArray(resp.data)) {
          for (const item of resp.data) {
            const name = item.display_name.split(',')[0].trim();
            const nameLower = name.toLowerCase();

            if (nameLower.includes('amphitheatre') || nameLower.includes('open air')) continue;

            const address = item.display_name.split(',').slice(1, 3).join(', ').trim() || 'Multiplex Screen';
            const { cinemaChain, associatedMall } = enrichCinemaData(name, address);

            places.push({
              id: `nom-cinema-${item.place_id}`,
              name,
              category: 'Cinema / Multiplex',
              categoryIcon: '🎬',
              cinemaChain,
              associatedMall,
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
              address,
              source: 'Nominatim'
            });
          }
        }
      } catch {
        // Continue
      }
    }
  }

  return deduplicatePlaces(places);
}

/**
 * Discovers entertainment centres: bowling, gaming zones, amusement arcades, escape rooms.
 */
async function fetchEntertainmentCentres(bbox, searchQuery = '') {
  const padding = 0.05;
  const s = bbox.minLat - padding;
  const w = bbox.minLng - padding;
  const n = bbox.maxLat + padding;
  const e = bbox.maxLng + padding;

  const places = [];

  // 1. Overpass API
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const q = searchQuery && searchQuery.trim()
        ? `[out:json][timeout:8];(nwr["name"~"${searchQuery.trim()}",i](${s},${w},${n},${e}););out center 25;`
        : `[out:json][timeout:8];(nwr["leisure"="bowling_alley"](${s},${w},${n},${e});nwr["leisure"="amusement_arcade"](${s},${w},${n},${e});nwr["leisure"="escape_game"](${s},${w},${n},${e});nwr["leisure"="water_park"](${s},${w},${n},${e});nwr["tourism"="theme_park"](${s},${w},${n},${e}););out center 25;`;

      const response = await axios.post(endpoint, `data=${encodeURIComponent(q)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 6000
      });

      if (response.data && response.data.elements && response.data.elements.length > 0) {
        for (const el of response.data.elements) {
          const lat = el.lat || (el.center && el.center.lat);
          const lng = el.lon || (el.center && el.center.lon);
          const tags = el.tags || {};
          const name = tags.name || tags['name:en'];
          if (!name || lat == null || lng == null) continue;

          places.push({
            id: `osm-ent-${el.id}`,
            name,
            category: 'Entertainment Centre',
            categoryIcon: '🎯',
            lat,
            lng,
            address: tags['addr:street'] ? `${tags['addr:street']}, ${tags['addr:city'] || ''}` : tags['addr:suburb'] || 'Entertainment Zone',
            source: 'OpenStreetMap'
          });
        }
        if (places.length > 0) break;
      }
    } catch {
      // Continue
    }
  }

  // 2. Nominatim fallback
  if (places.length < 8) {
    const terms = searchQuery && searchQuery.trim()
      ? [searchQuery.trim()]
      : ['bowling alley', 'gaming zone', 'amusement park', 'escape room', 'entertainment centre'];

    for (const term of terms) {
      try {
        const resp = await axios.get(NOMINATIM_SEARCH_URL, {
          params: {
            q: term,
            format: 'json',
            viewbox: `${w},${n},${e},${s}`,
            bounded: 1,
            limit: 8,
            addressdetails: 1
          },
          headers: APP_HEADERS,
          timeout: 5000
        });

        if (resp.data && Array.isArray(resp.data)) {
          for (const item of resp.data) {
            const name = item.display_name.split(',')[0].trim();
            places.push({
              id: `nom-ent-${item.place_id}`,
              name,
              category: 'Entertainment Centre',
              categoryIcon: '🎯',
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
              address: item.display_name.split(',').slice(1, 3).join(', ').trim() || 'Entertainment Zone',
              source: 'Nominatim'
            });
          }
        }
      } catch {
        // Continue
      }
    }
  }

  return deduplicatePlaces(places);
}

/**
 * Discovers famous spots, landmarks, monuments, heritage sites, and attractions.
 * Uses a multi-tiered approach:
 * 1. OpenStreetMap Nominatim with targeted landmark keywords
 * 2. Wikipedia Geosearch for notable landmarks and heritage sites
 * 3. Overpass API for structured tourism & historic tags
 * Automatically expands search area if no results are found in the initial radius.
 */
async function fetchFamousSpots(bbox, searchQuery = '', radiusKm = 12) {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLng = (bbox.minLng + bbox.maxLng) / 2;

  const places = [];

  const addPlace = (item) => {
    if (!item.name || item.lat == null || item.lng == null) return;
    const cleanName = item.name.trim().toLowerCase();

    for (const p of places) {
      if (p.name.toLowerCase() === cleanName) return;
      if (calculateDistanceKm(p.lat, p.lng, item.lat, item.lng) < 0.15) return;
    }

    places.push(item);
  };

  // 1. Nominatim Landmark Searches
  const padding = Math.max(0.06, (bbox.maxLat - bbox.minLat) * 0.4);
  const s = bbox.minLat - padding;
  const w = bbox.minLng - padding;
  const n = bbox.maxLat + padding;
  const e = bbox.maxLng + padding;

  const nomTerms = searchQuery && searchQuery.trim()
    ? [searchQuery.trim()]
    : ['attraction', 'monument', 'museum', 'palace', 'fort', 'heritage'];

  for (const term of nomTerms) {
    try {
      const resp = await axios.get(NOMINATIM_SEARCH_URL, {
        params: {
          q: term,
          format: 'json',
          viewbox: `${w},${n},${e},${s}`,
          bounded: 1,
          limit: 12,
          addressdetails: 1
        },
        headers: APP_HEADERS,
        timeout: 5000
      });

      if (resp.data && Array.isArray(resp.data)) {
        for (const item of resp.data) {
          const name = item.display_name.split(',')[0].trim();
          let icon = '📸';
          let category = 'Famous Attraction';

          const t = item.type || '';
          const nameLower = name.toLowerCase();

          if (t === 'museum' || nameLower.includes('museum') || nameLower.includes('gallery')) {
            icon = '🏛️';
            category = 'Museum & Art Gallery';
          } else if (t === 'castle' || t === 'fort' || nameLower.includes('fort') || nameLower.includes('palace') || nameLower.includes('tomb')) {
            icon = '🏰';
            category = 'Historical Fort & Palace';
          } else if (t === 'monument' || t === 'memorial' || nameLower.includes('statue') || nameLower.includes('memorial')) {
            icon = '🗿';
            category = 'Monument & Heritage';
          } else if (t === 'place_of_worship' || nameLower.includes('temple') || nameLower.includes('mandir') || nameLower.includes('mosque') || nameLower.includes('church')) {
            icon = '🕌';
            category = 'Famous Temple & Heritage Site';
          } else if (nameLower.includes('lake') || nameLower.includes('park') || nameLower.includes('garden')) {
            icon = '🌳';
            category = 'Popular Viewpoint & Nature';
          }

          addPlace({
            id: `nom-${item.place_id}`,
            name,
            category,
            categoryIcon: icon,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            address: item.display_name.split(',').slice(1, 4).join(', ').trim() || 'Nearby',
            source: 'OpenStreetMap'
          });
        }
      }
    } catch {
      // Continue to next term
    }
  }

  // 2. Wikipedia Geosearch
  try {
    const radiusM = Math.min(10000, Math.round(radiusKm * 1000));
    const wikiResp = await axios.get(WIKIPEDIA_GEOSEARCH_URL, {
      params: {
        action: 'query',
        list: 'geosearch',
        gscoord: `${centerLat}|${centerLng}`,
        gsradius: radiusM,
        gslimit: 50,
        format: 'json'
      },
      headers: APP_HEADERS,
      timeout: 6000
    });

    const blacklist = [
      'constituency', 'assembly', 'metro station', 'railway station', 'bus station',
      'depot', 'expressway', 'flyover', 'corridor', 'sub-district', 'mandal', 'district',
      'locality', 'tehsil', 'census town', 'neighborhood', 'neighbourhood', 'taluk'
    ];

    const pages = wikiResp.data?.query?.geosearch || [];
    for (const page of pages) {
      const titleLower = page.title.toLowerCase();
      if (blacklist.some(b => titleLower.includes(b))) continue;

      let icon = '📸';
      let category = 'Famous Landmark';

      if (titleLower.includes('palace') || titleLower.includes('fort') || titleLower.includes('castle') || titleLower.includes('tomb') || titleLower.includes('gate')) {
        icon = '🏰';
        category = 'Historical Fort & Palace';
      } else if (titleLower.includes('museum') || titleLower.includes('gallery') || titleLower.includes('planetarium')) {
        icon = '🏛️';
        category = 'Museum & Art Gallery';
      } else if (titleLower.includes('temple') || titleLower.includes('mosque') || titleLower.includes('church') || titleLower.includes('mandir') || titleLower.includes('cathedral')) {
        icon = '🕌';
        category = 'Famous Temple & Heritage Site';
      } else if (titleLower.includes('park') || titleLower.includes('garden') || titleLower.includes('lake') || titleLower.includes('sagar')) {
        icon = '🌳';
        category = 'Popular Viewpoint & Lake';
      }

      addPlace({
        id: `wiki-${page.pageid}`,
        name: page.title,
        category,
        categoryIcon: icon,
        lat: page.lat,
        lng: page.lon,
        address: 'Notable Heritage & Attraction',
        source: 'Wikipedia'
      });
    }
  } catch {
    // Continue
  }

  // 3. Fast Overpass Query
  if (places.length < 15) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const overpassQuery = `[out:json][timeout:6];(nwr["tourism"="attraction"](${s},${w},${n},${e});nwr["historic"="monument"](${s},${w},${n},${e});nwr["historic"="fort"](${s},${w},${n},${e});nwr["historic"="palace"](${s},${w},${n},${e});nwr["tourism"="museum"](${s},${w},${n},${e}););out center 30;`;
        const response = await axios.post(endpoint, `data=${encodeURIComponent(overpassQuery)}`, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 6000
        });

        if (response.data && response.data.elements && response.data.elements.length > 0) {
          for (const el of response.data.elements) {
            const lat = el.lat || (el.center && el.center.lat);
            const lng = el.lon || (el.center && el.center.lon);
            const tags = el.tags || {};
            const name = tags.name || tags['name:en'];
            if (!name || lat == null || lng == null) continue;

            let icon = '📸';
            let category = 'Famous Spot';
            if (tags.tourism === 'museum') {
              icon = '🏛️';
              category = 'Museum & Art Gallery';
            } else if (tags.historic === 'fort' || tags.historic === 'palace') {
              icon = '🏰';
              category = 'Historical Fort & Palace';
            }

            addPlace({
              id: `osm-${el.id}`,
              name,
              category,
              categoryIcon: icon,
              lat,
              lng,
              address: tags['addr:street'] ? `${tags['addr:street']}, ${tags['addr:city'] || ''}` : 'Heritage Destination',
              source: 'OpenStreetMap'
            });
          }
          break;
        }
      } catch {
        // Try next endpoint
      }
    }
  }

  // 4. Gradual Expansion:
  // If zero places are found inside the initial area, expand the search radius
  if (places.length === 0 && radiusKm < 25) {
    return fetchFamousSpots(bbox, searchQuery, 25);
  }

  return places;
}

/**
 * Standard POI search for cafes, restaurants, parks, shopping, etc.
 */
async function fetchStandardPois(bbox, categoryId, categoryObj, searchQuery = '') {
  const padding = 0.03;
  const s = bbox.minLat - padding;
  const w = bbox.minLng - padding;
  const n = bbox.maxLat + padding;
  const e = bbox.maxLng + padding;

  let overpassTagSelector = '';
  switch (categoryId) {
    case 'restaurant':
      overpassTagSelector = `nwr["amenity"="restaurant"](${s},${w},${n},${e});`;
      break;
    case 'cafe':
      overpassTagSelector = `nwr["amenity"="cafe"](${s},${w},${n},${e});nwr["cuisine"="coffee_shop"](${s},${w},${n},${e});`;
      break;
    case 'park':
      overpassTagSelector = `nwr["leisure"="park"](${s},${w},${n},${e});nwr["leisure"="garden"](${s},${w},${n},${e});`;
      break;
    case 'shopping':
      overpassTagSelector = `nwr["shop"="department_store"](${s},${w},${n},${e});nwr["amenity"="marketplace"](${s},${w},${n},${e});nwr["shop"="supermarket"](${s},${w},${n},${e});`;
      break;
    default:
      overpassTagSelector = `nwr["name"~"${searchQuery || categoryObj.defaultQuery}",i](${s},${w},${n},${e});`;
  }

  // Try Overpass API first
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      let overpassQuery = '';
      if (searchQuery && searchQuery.trim()) {
        overpassQuery = `[out:json][timeout:8];(nwr["name"~"${searchQuery.trim()}",i](${s},${w},${n},${e}););out center 25;`;
      } else {
        overpassQuery = `[out:json][timeout:8];(${overpassTagSelector});out center 25;`;
      }

      const response = await axios.post(endpoint, `data=${encodeURIComponent(overpassQuery)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 7000
      });

      if (response.data && response.data.elements && response.data.elements.length > 0) {
        const places = response.data.elements
          .filter(el => el.tags && (el.tags.name || el.tags.amenity || el.tags.shop || el.tags.tourism || el.tags.leisure))
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

        if (places.length > 0) return deduplicatePlaces(places);
      }
    } catch {
      // Try next endpoint
    }
  }

  // Fallback to Nominatim POI search with proper category term
  try {
    const q = searchQuery.trim() ? searchQuery.trim() : (categoryObj.defaultQuery || categoryObj.label);
    const response = await axios.get(NOMINATIM_SEARCH_URL, {
      params: {
        q,
        format: 'json',
        viewbox: `${w},${n},${e},${s}`,
        bounded: 1,
        limit: 20,
        addressdetails: 1
      },
      headers: APP_HEADERS,
      timeout: 6000
    });

    if (response.data && response.data.length > 0) {
      const places = response.data.map((item, idx) => ({
        id: `nom-${item.place_id || idx}`,
        name: item.display_name.split(',')[0] || item.display_name,
        category: categoryObj.label,
        categoryIcon: categoryObj.icon,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        address: item.display_name.split(',').slice(1, 3).join(', ').trim() || 'Nearby'
      }));
      return deduplicatePlaces(places);
    }
  } catch {
    // Continue
  }

  return [];
}

/**
 * Main public entry point to fetch places in the group area.
 * Includes in-memory caching for snappy category navigation.
 * 
 * @param {{minLat: number, minLng: number, maxLat: number, maxLng: number}} bbox 
 * @param {string} categoryId Category key (malls, restaurant, cafe, cinemas, famous, park, shopping, tourist, entertainment)
 * @param {string} [searchQuery=''] Custom search query string
 */
export async function fetchPlacesInArea(bbox, categoryId = 'malls', searchQuery = '') {
  if (!bbox) {
    throw new Error('Valid area coordinates are required to search places.');
  }

  // Check in-memory cache
  const cacheKey = getCacheKey(categoryId, bbox, searchQuery);
  const cached = placesCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const categoryObj = PLACE_CATEGORIES.find(c => c.id === categoryId) || PLACE_CATEGORIES[0];
  let results = [];

  switch (categoryId) {
    case 'malls':
      results = await fetchShoppingMalls(bbox, searchQuery);
      break;
    case 'cinemas':
      results = await fetchCinemas(bbox, searchQuery);
      break;
    case 'entertainment':
      results = await fetchEntertainmentCentres(bbox, searchQuery);
      break;
    case 'famous':
    case 'tourist':
      results = await fetchFamousSpots(bbox, searchQuery);
      break;
    default:
      results = await fetchStandardPois(bbox, categoryId, categoryObj, searchQuery);
      break;
  }

  // Cache results
  placesCache.set(cacheKey, {
    data: results,
    timestamp: Date.now()
  });

  return results;
}
