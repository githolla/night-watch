import revenueFocus from "../../../data/revenue-focus.json" with { type: "json" };
import batch2Focus from "../../../data/batch-2-focus.json" with { type: "json" };
import batch3Focus from "../../../data/batch-3-focus.json" with { type: "json" };
import dossiers from "../../../data/dossiers/index.json" with { type: "json" };
import revenueFocusDossiers from "../../../data/dossiers/revenue-focus-index.json" with { type: "json" };
import priorityOutreach from "../../../data/priority-outreach.json" with { type: "json" };
import offerVersions from "../../../data/offer-versions.json" with { type: "json" };
import batch2Offers from "../../../data/batch-2-offers.json" with { type: "json" };
import batch3Offers from "../../../data/batch-3-offers.json" with { type: "json" };
import researchOutreach from "../../../data/research-outreach.json" with { type: "json" };
import outreachGifts from "../../../data/outreach-gifts.json" with { type: "json" };
import batch2OffersArchive from "../../../data/batch-2-offers-archive.json" with { type: "json" };
import outreachVariantsArchive from "../../../data/outreach-variants-archive.json" with { type: "json" };
import linkedinVariantsArchive from "../../../data/linkedin-variants-archive.json" with { type: "json" };

/**
 * The researched list data, every row keyed by `domain`. Imported as "#research-data": the server (and the
 * tests) resolve this file with everything in it; browsers resolve ./client.ts, which holds only the rows a
 * page sent down. Without the split, the reach-out page shipped all of it, about 2.3 MB, to every browser.
 */
const full = {
  revenueFocus, batch2Focus, batch3Focus, dossiers, revenueFocusDossiers, priorityOutreach, offerVersions, batch2Offers, batch3Offers,
  researchOutreach, outreachGifts, batch2OffersArchive, outreachVariantsArchive, linkedinVariantsArchive,
};

export type ResearchData = typeof full;

export function researchData(): ResearchData {
  return full;
}

/** The server always has the full set, so it never changes. */
export function researchVersion() {
  return 0;
}

/** Only browsers load a page's slice; on the server the full set is already here. */
export function hydrateResearch(slice: ResearchData | null | undefined) {
  void slice;
}
