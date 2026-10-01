import type { ResearchData } from "./server.ts";

/** Browser half of "#research-data": empty until a page hands over its slice (see server.ts). */
const EMPTY: ResearchData = {
  revenueFocus: [], batch2Focus: [], batch3Focus: [], dossiers: [], revenueFocusDossiers: [], priorityOutreach: [], offerVersions: [],
  batch2Offers: [], batch3Offers: [], researchOutreach: [], outreachGifts: [], batch2OffersArchive: [], outreachVariantsArchive: [],
  linkedinVariantsArchive: [],
};

let data: ResearchData = EMPTY;
let version = 0;

export function researchData(): ResearchData {
  return data;
}

/** Bumped whenever a new slice arrives, so derived lookups rebuild. */
export function researchVersion() {
  return version;
}

export function hydrateResearch(slice: ResearchData | null | undefined) {
  if (!slice || slice === data) return;
  data = slice;
  version += 1;
}
