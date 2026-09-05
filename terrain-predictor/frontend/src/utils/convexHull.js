/**
 * Calculates the Convex Hull of a set of 2D coordinates ({lat, lng})
 * using Andrew's Monotone Chain algorithm.
 * 
 * @param {Array<{lat: number, lng: number}>} points 
 * @returns {Array<{lat: number, lng: number}>} Ordered array of points forming the outer boundary
 */
export function getConvexHull(points) {
  if (!points || points.length === 0) return [];
  if (points.length <= 3) return [...points];

  // Sort points primarily by longitude (x), secondarily by latitude (y)
  const sorted = [...points].sort((a, b) => {
    if (a.lng === b.lng) return a.lat - b.lat;
    return a.lng - b.lng;
  });

  // Cross product of 2D vectors OA and OB
  // returns > 0 if counter-clockwise, < 0 if clockwise, 0 if collinear
  const crossProduct = (o, a, b) => {
    return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  };

  // Build lower hull
  const lower = [];
  for (let i = 0; i < sorted.length; i++) {
    while (
      lower.length >= 2 &&
      crossProduct(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0
    ) {
      lower.pop();
    }
    lower.push(sorted[i]);
  }

  // Build upper hull
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (
      upper.length >= 2 &&
      crossProduct(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0
    ) {
      upper.pop();
    }
    upper.push(sorted[i]);
  }

  // Remove duplicate last points of lower and upper hulls
  lower.pop();
  upper.pop();

  return lower.concat(upper);
}
