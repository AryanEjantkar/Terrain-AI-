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

  // Sort candidates by tier first, then by score:
  // 1. Places inside polygon come first (groupTier === 'inside')
  // 2. Places nearby outside polygon follow (groupTier === 'nearby')
  // 3. Popular regional destinations follow (groupTier === 'popular')
  const tierWeight = { inside: 0, nearby: 1, popular: 2 };

  scoredCandidates.sort((a, b) => {
    const tierA = tierWeight[a.groupTier] != null ? tierWeight[a.groupTier] : (a.isInsidePolygon ? 0 : 1);
    const tierB = tierWeight[b.groupTier] != null ? tierWeight[b.groupTier] : (b.isInsidePolygon ? 0 : 1);
    if (tierA !== tierB) return tierA - tierB;
    return a.score - b.score;
  });

  return {
    rankedPlaces: scoredCandidates,
    bestSpot: scoredCandidates[0] || null
  };
}
