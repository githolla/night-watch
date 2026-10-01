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
const curated = {
  revenueFocus, batch2Focus, batch3Focus, dossiers, revenueFocusDossiers, priorityOutreach, offerVersions, batch2Offers, batch3Offers,
  researchOutreach, outreachGifts, batch2OffersArchive, outreachVariantsArchive, linkedinVariantsArchive,
};

/** A nightly list item has exactly the shape of a curated batch row, so every lookup treats it alike. */
export type ListRow = (typeof batch3Focus)[number];
export type ListOffer = (typeof batch3Offers)[number];
export type ListOwnerKey = "josh" | "suuchi";
type Nightly = { nightlyFocus: ListRow[]; nightlyOffers: ListOffer[]; nightlyLatest: Record<ListOwnerKey, string[]> };

export type ResearchData = typeof curated & Nightly;

// Nightly lists live in the database (reachout_lists). loadNightlyLists() reads them and calls
// setNightlyLists; until then they are empty and only the curated files are known.
let nightly: Nightly = { nightlyFocus: [], nightlyOffers: [], nightlyLatest: { josh: [], suuchi: [] } };
let version = 0;
let snapshot: ResearchData = { ...curated, ...nightly };

export function setNightlyLists(next: Nightly) {
  nightly = next;
  version += 1;
  snapshot = { ...curated, ...nightly };
}

export function researchData(): ResearchData {
  return snapshot;
}

/** Bumped whenever the nightly lists are reloaded, so derived lookups rebuild. */
export function researchVersion() {
  return version;
}

/** Only browsers load a page's slice; on the server the full set is already here. */
export function hydrateResearch(slice: ResearchData | null | undefined) {
  void slice;
}
