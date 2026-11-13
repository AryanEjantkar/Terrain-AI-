import { calculateHaversineDistance, formatDistance } from './geoUtils.js';

/**
 * Calculates travel distances for all group members to each candidate place and ranks candidates
 * to determine the Best Meeting Spot (minimizing aggregate and maximum travel burden).
 * Prioritizes places located inside the group's polygon boundary before outside spots.
 * 
 * @param {Array<Object>} candidatePlaces 
 * @param {Array<{id: string, name: string, lat: number, lng: number}>} people 
 * @returns {{ rankedPlaces: Array<Object>, bestSpot: Object | null }}
 */
export function rankMeetingSpots(candidatePlaces, people) {
  if (!candidatePlaces || candidatePlaces.length === 0 || !people || people.length === 0) {
    return { rankedPlaces: [], bestSpot: null };
  }

  const scoredCandidates = candidatePlaces.map(place => {
    let totalDistanceKm = 0;
    let maxDistanceKm = 0;

    const memberDistances = people.map(person => {
      const dist = calculateHaversineDistance(person.lat, person.lng, place.lat, place.lng);
      totalDistanceKm += dist;
      if (dist > maxDistanceKm) maxDistanceKm = dist;

      return {
        personId: person.id,
        personName: person.name,
        distanceKm: dist,
        distanceFormatted: formatDistance(dist)
      };
    });

    const avgDistanceKm = totalDistanceKm / people.length;
    // Score combines average travel distance with max individual burden to avoid unfair long travel for one person
    const score = avgDistanceKm * 0.7 + maxDistanceKm * 0.3;

    return {
      ...place,
      memberDistances,
      totalDistanceKm,
      avgDistanceKm,
      maxDistanceKm,
      score
    };
  });

  // Sort candidates:
  // 1. Places inside polygon come first (sorted by score ascending)
  // 2. Places outside polygon follow (sorted by score ascending)
  scoredCandidates.sort((a, b) => {
    if (a.isInsidePolygon && !b.isInsidePolygon) return -1;
    if (!a.isInsidePolygon && b.isInsidePolygon) return 1;
    return a.score - b.score;
  });

  return {
    rankedPlaces: scoredCandidates,
    bestSpot: scoredCandidates[0] || null
  };
}
