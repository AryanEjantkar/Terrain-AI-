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

const PHOTON_SEARCH_URL = 'https://photon.komoot.io/api/';

// Real-world verified major multiplexes inside shopping malls
const KNOWN_MALL_MULTIPLEXES = [
  {
    mallMatches: ['dsl virtue', 'dsl abacus', 'dsl mall', 'dsl', 'virtue mall', 'abacus mall'],
    cinemaName: 'Cinépolis (DSL Virtue Mall)',
    aliases: ['Cinepolis at DSL Virtue Mall', 'Cinepolis DSL Abacus Mall', 'Cinepolis Uppal'],
    cinemaChain: 'Cinépolis',
    associatedMall: 'DSL Virtue Mall',
    lat: 17.4001877,
    lng: 78.5550594,
    address: 'DSL Virtue Mall, 3rd Floor, Uppal, Hyderabad, Telangana 500039'
  },
  {
    mallMatches: ['next galleria moosarambagh', 'next mall @ moosarambagh', 'moosarambagh mall', 'next galleria'],
    cinemaName: 'PVR Cinemas (Next Galleria Moosarambagh)',
    aliases: ['PVR Moosarambagh', 'PVR Malakpet'],
    cinemaChain: 'PVR Cinemas',
    associatedMall: 'Next Galleria Mall',
    lat: 17.3715742,
    lng: 78.5095629,
    address: 'Next Galleria Mall, Moosarambagh, Malakpet, Hyderabad, Telangana 500036'
  },
  {
    mallMatches: ['amr planet', 'amr mall', 'planet mall'],
    cinemaName: 'MovieMax (AMR Planet Mall)',
    aliases: ['MovieMax ECIL', 'INOX AMR Planet'],
    cinemaChain: 'MovieMax',
    associatedMall: 'AMR Planet Mall',
    lat: 17.4633360,
    lng: 78.5603338,
    address: 'AMR Planet Mall, Moula Ali Road, ECIL, Hyderabad, Telangana 500062'
  },
  {
    mallMatches: ['inorbit', 'inorbit mall'],
    cinemaName: 'PVR Cinemas (Inorbit Mall)',
    aliases: ['PVR Inorbit', 'PVR Madhapur'],
    cinemaChain: 'PVR Cinemas',
    associatedMall: 'Inorbit Mall',
    lat: 17.4343,
    lng: 78.3867,
    address: 'Inorbit Mall, Mindspace, Madhapur, Hyderabad, Telangana 500081'
  },
  {
    mallMatches: ['nexus', 'forum sujana', 'forum mall'],
    cinemaName: 'PVR INOX (Nexus Mall)',
    aliases: ['PVR Forum Sujana', 'PVR Kukatpally'],
    cinemaChain: 'PVR INOX',
    associatedMall: 'Nexus Hyderabad',
    lat: 17.4842,
    lng: 78.3888,
    address: 'Nexus Hyderabad, KPHB Colony, Kukatpally, Hyderabad, Telangana 500072'
  },
  {
    mallMatches: ['sarath city', 'capital mall', 'sarath city capital'],
    cinemaName: 'AMB Cinemas (Sarath City Capital Mall)',
    aliases: ['AMB Cinemas Gachibowli', 'AMB Cinemas Kondapur'],
    cinemaChain: 'AMB Cinemas',
    associatedMall: 'Sarath City Capital Mall',
    lat: 17.4578,
    lng: 78.3638,
    address: 'Sarath City Capital Mall, Gachibowli - Miyapur Rd, Whitefields, Hyderabad, Telangana 500084'
  },
  {
    mallMatches: ['gvk one', 'gvk mall'],
    cinemaName: 'INOX (GVK One Mall)',
    aliases: ['INOX Banjara Hills', 'INOX GVK'],
    cinemaChain: 'INOX',
    associatedMall: 'GVK One',
    lat: 17.4195,
    lng: 78.4487,
    address: 'GVK One Mall, Road No. 1, Banjara Hills, Hyderabad, Telangana 500034'
  },
  {
    mallMatches: ['prasads', 'prasad imax', 'prasads multiplex'],
    cinemaName: 'Prasads Multiplex (IMAX & Large Screen)',
    aliases: ['Prasads IMAX', 'Prasads Large Screen'],
    cinemaChain: 'Prasads Multiplex',
    associatedMall: 'Prasads Multiplex',
    lat: 17.4124,
    lng: 78.4682,
    address: 'Prasads Multiplex, NTR Marg, Central Secretariat, Khairatabad, Hyderabad, Telangana 500063'
  }
];

/**
 * Discovers cinema halls and multiplexes across 4 resilient layers:
 * 1. Overpass API (amenity=cinema, leisure=cinema)
 * 2. Nominatim with cinema, multiplex, Cinepolis, PVR, INOX terms
 * 3. Photon API with location bias
 * 4. Shopping mall multiplex association & real-world mall registry
 */
async function fetchCinemas(bbox, searchQuery = '') {
  const padding = 0.055;
  const s = bbox.minLat - padding;
  const w = bbox.minLng - padding;
  const n = bbox.maxLat + padding;
  const e = bbox.maxLng + padding;

  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLng = (bbox.minLng + bbox.maxLng) / 2;

  console.log(`[CINEMA PIPELINE] Step 1: Starting cinema discovery. BBox: [${s.toFixed(3)}, ${w.toFixed(3)}, ${n.toFixed(3)}, ${e.toFixed(3)}], SearchQuery: "${searchQuery}"`);

  const rawPlaces = [];

  // 1. Overpass API for amenity=cinema & leisure=cinema
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const q = searchQuery && searchQuery.trim()
        ? `[out:json][timeout:8];(nwr["amenity"="cinema"]["name"~"${searchQuery.trim()}",i](${s},${w},${n},${e});nwr["name"~"${searchQuery.trim()}",i]["leisure"="cinema"](${s},${w},${n},${e}););out center 30;`
        : `[out:json][timeout:8];(nwr["amenity"="cinema"](${s},${w},${n},${e});nwr["leisure"="cinema"](${s},${w},${n},${e});nwr["theater_type"="cinema"](${s},${w},${n},${e}););out center 30;`;

      const response = await axios.post(endpoint, `data=${encodeURIComponent(q)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 6000
      });

      if (response.data && response.data.elements && response.data.elements.length > 0) {
        console.log(`[CINEMA PIPELINE] Step 2: Overpass returned ${response.data.elements.length} elements from ${endpoint}`);
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

          rawPlaces.push({
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
        if (rawPlaces.length > 0) break;
      }
    } catch (err) {
      console.warn(`[CINEMA PIPELINE] Overpass mirror ${endpoint} failed:`, err.message);
    }
  }

  // 2. Nominatim fallback with comprehensive cinema terms & mall searches
  const cinemaTerms = searchQuery && searchQuery.trim()
    ? [searchQuery.trim()]
    : ['cinema', 'multiplex', 'Cinepolis', 'PVR', 'INOX', 'movie theatre', 'theatre', 'mall'];

  for (const term of cinemaTerms) {
    try {
      const resp = await axios.get(NOMINATIM_SEARCH_URL, {
        params: {
          q: term,
          format: 'json',
          viewbox: `${w},${n},${e},${s}`,
          bounded: term === 'mall' ? 1 : 0,
          limit: 12,
          addressdetails: 1
        },
        headers: APP_HEADERS,
        timeout: 5000
      });

      if (resp.data && Array.isArray(resp.data)) {
        console.log(`[CINEMA PIPELINE] Step 3: Nominatim query '${term}' returned ${resp.data.length} results`);
        for (const item of resp.data) {
          const name = item.display_name.split(',')[0].trim();
          const nameLower = name.toLowerCase();

          if (nameLower.includes('amphitheatre') || nameLower.includes('open air')) continue;

          const lat = parseFloat(item.lat);
          const lng = parseFloat(item.lon);
          if (isNaN(lat) || isNaN(lng)) continue;

          // Check if within reasonable region (within 35km of centroid)
          const distToCenter = calculateDistanceKm(centerLat, centerLng, lat, lng);
          if (distToCenter > 35) continue;

          // If term was 'mall', check if it houses a cinema or is a shopping mall
          if (term === 'mall') {
            const knownMall = KNOWN_MALL_MULTIPLEXES.find(km =>
              km.mallMatches.some(m => nameLower.includes(m))
            );
            if (knownMall) {
              rawPlaces.push({
                id: `mall-cinema-${item.place_id}`,
                name: knownMall.cinemaName,
                category: 'Cinema / Multiplex',
                categoryIcon: '🎬',
                cinemaChain: knownMall.cinemaChain,
                associatedMall: knownMall.associatedMall,
                lat: knownMall.lat,
                lng: knownMall.lng,
                address: knownMall.address,
                source: 'Mall Registry & Nominatim'
              });
            }
            continue;
          }

          const address = item.display_name.split(',').slice(1, 3).join(', ').trim() || 'Multiplex Screen';
          const { cinemaChain, associatedMall } = enrichCinemaData(name, address);

          rawPlaces.push({
            id: `nom-cinema-${item.place_id}`,
            name,
            category: 'Cinema / Multiplex',
            categoryIcon: '🎬',
            cinemaChain,
            associatedMall,
            lat,
            lng,
            address,
            source: 'Nominatim'
          });
        }
      }
    } catch (err) {
      console.warn(`[CINEMA PIPELINE] Nominatim query for '${term}' failed:`, err.message);
    }
  }

  // 3. Photon Komoot API fallback (fast, location-biased secondary search)
  const photonTerms = searchQuery && searchQuery.trim()
    ? [searchQuery.trim()]
    : ['cinema', 'multiplex', 'Cinepolis', 'PVR', 'INOX'];

  for (const pTerm of photonTerms) {
    try {
      const pResp = await axios.get(PHOTON_SEARCH_URL, {
        params: {
          q: pTerm,
          lat: centerLat,
          lon: centerLng,
          limit: 10
        },
        headers: APP_HEADERS,
        timeout: 5000
      });

      if (pResp.data && pResp.data.features && Array.isArray(pResp.data.features)) {
        console.log(`[CINEMA PIPELINE] Step 4: Photon query '${pTerm}' returned ${pResp.data.features.length} features`);
        for (const feat of pResp.data.features) {
          const props = feat.properties || {};
          const name = props.name || pTerm;
          const nameLower = name.toLowerCase();
          const [lon, lat] = feat.geometry.coordinates;

          if (nameLower.includes('amphitheatre') || nameLower.includes('open air')) continue;

          const distToCenter = calculateDistanceKm(centerLat, centerLng, lat, lon);
          if (distToCenter > 30) continue;

          const address = props.street
            ? `${props.street}, ${props.city || props.district || ''}`
            : props.city || 'Multiplex';

          const { cinemaChain, associatedMall } = enrichCinemaData(name, address);

          rawPlaces.push({
            id: `photon-cinema-${props.osm_id || Math.random().toString(36).substr(2, 9)}`,
            name,
            category: 'Cinema / Multiplex',
            categoryIcon: '🎬',
            cinemaChain,
            associatedMall,
            lat: parseFloat(lat),
            lng: parseFloat(lon),
            address,
            source: 'Photon API'
          });
        }
      }
    } catch (err) {
      console.warn(`[CINEMA PIPELINE] Photon query '${pTerm}' failed:`, err.message);
    }
  }

  // 4. Check known regional mall multiplexes in the bounding box + surrounding area
  for (const km of KNOWN_MALL_MULTIPLEXES) {
    // If user searched for custom query (e.g. "Cinepolis", "DSL", "Virtue", "Abacus")
    const matchesQuery = searchQuery && searchQuery.trim()
      ? (
          km.cinemaName.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
          km.associatedMall.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
          km.aliases.some(a => a.toLowerCase().includes(searchQuery.trim().toLowerCase())) ||
          km.mallMatches.some(m => searchQuery.trim().toLowerCase().includes(m))
        )
      : true;

    // Is it in or near the bounding box (within bbox + 0.1 deg padding or 20km)?
    const dist = calculateDistanceKm(centerLat, centerLng, km.lat, km.lng);
    const inBboxPadded = (
      km.lat >= (s - 0.05) && km.lat <= (n + 0.05) &&
      km.lng >= (w - 0.05) && km.lng <= (e + 0.05)
    );

    if (matchesQuery && (inBboxPadded || dist <= 22)) {
      console.log(`[CINEMA PIPELINE] Step 5: Adding verified mall multiplex: ${km.cinemaName} at (${km.lat}, ${km.lng})`);
      rawPlaces.push({
        id: `verified-multiplex-${km.associatedMall.replace(/\s+/g, '-').toLowerCase()}`,
        name: km.cinemaName,
        category: 'Cinema / Multiplex',
        categoryIcon: '🎬',
        cinemaChain: km.cinemaChain,
        associatedMall: km.associatedMall,
        lat: km.lat,
        lng: km.lng,
        address: km.address,
        source: 'Verified Mall Multiplex Registry'
      });
    }
  }

  console.log(`[CINEMA PIPELINE] Step 6: Total raw candidates before deduplication: ${rawPlaces.length}`);
  const deduplicated = deduplicatePlaces(rawPlaces);
  console.log(`[CINEMA PIPELINE] Step 7: Deduplicated cinemas returned: ${deduplicated.length}`);

  return deduplicated;
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
