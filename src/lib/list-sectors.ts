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
 * Two sectors a night: the best one by base order and learned reply rate that was not searched yesterday,
 * plus one in rotation so every sector keeps getting explored.
 */
export function sectorsForNight(day: number, weights: Record<string, number>) {
  const ranked = SECTORS.map((_, index) => index).sort((a, b) => (weights[String(b)] ?? 1) * (SECTORS.length - b) - (weights[String(a)] ?? 1) * (SECTORS.length - a));
  const best = ranked[day % 2];
  const explore = (day * 3) % SECTORS.length === best ? ((day * 3) + 1) % SECTORS.length : (day * 3) % SECTORS.length;
  return [best, explore];
}
