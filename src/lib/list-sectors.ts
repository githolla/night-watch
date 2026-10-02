/**
 * Sectors like the curated lists (operating businesses, never consulting, IT, software or staffing), ordered
 * by how much repetitive coordination and paperwork the work carries: dispatching crews, scheduling, quoting,
 * order entry and compliance records come first. Replies re-weight this order over time (sectorWeights).
 */
export const SECTORS = [
  "specialty construction trades such as HVAC, plumbing, electrical and roofing contractors",
  "pest control, cleaning, restoration and other commercial or home services",
  "landscape construction and commercial grounds maintenance",
  "wholesale distribution",
  "trucking, logistics and warehousing",
  "tree care and utility vegetation management",
  "food and beverage manufacturing and processing",
  "industrial and contract manufacturing",
  "automotive suppliers and dealership groups",
  "multi-unit restaurant operators and franchisees",
];
/**
 * Two sectors a night: the best one by learned reply rate that was not searched yesterday, plus one in
 * rotation so every sector keeps getting explored. The base order only breaks ties (a factor of 1.05 to
 * 1.5), so a learned weight can lift any sector to the top.
 */
export function sectorsForNight(day: number, weights: Record<string, number>) {
  const count = SECTORS.length;
  const strength = (index: number) => (weights[String(index)] ?? 1) * (1 + (count - index) / (2 * count));
  const ranked = SECTORS.map((_, index) => index).sort((a, b) => strength(b) - strength(a));
  const best = ranked[day % 2];
  // Offset by one so that, with no weights, the rotation never lands on that night's best and so visits
  // every sector over any 10 nights.
  const slot = (day * 3 + 1) % count;
  const explore = slot === best ? (slot + 1) % count : slot;
  return [best, explore];
}
