import { researchData, type ResearchData } from "./server.ts";

const key = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];

/**
 * What one page's browser needs from the research data: every row for the companies on screen, and a thin
 * row (company, domain, owner, rank, revenue, trigger) for the rest of the lists so list-wide facts like
 * batch membership and "All 25 companies" still hold. About a tenth of the full set.
 */
export function researchSlice(domains: Iterable<string | null | undefined>): ResearchData {
  const keep = new Set([...domains].filter((domain): domain is string => Boolean(domain)).map(key));
  const full = researchData();
  const pick = <T extends { domain: string }>(rows: readonly T[]) => rows.filter((row) => keep.has(key(row.domain)));
  const thin = <T extends { domain: string; contacts: unknown[] }>(rows: readonly T[]) => rows.map((row) => keep.has(key(row.domain)) ? row : {
    ...row, contacts: [], message: "", hypothesis: "", limitations: "", writerKit: undefined,
  } as unknown as T);
  return {
    revenueFocus: thin(full.revenueFocus),
    batch2Focus: thin(full.batch2Focus),
    batch3Focus: thin(full.batch3Focus),
    dossiers: pick(full.dossiers),
    revenueFocusDossiers: pick(full.revenueFocusDossiers),
    priorityOutreach: pick(full.priorityOutreach),
    offerVersions: pick(full.offerVersions),
    batch2Offers: pick(full.batch2Offers),
    batch3Offers: pick(full.batch3Offers),
    researchOutreach: pick(full.researchOutreach),
    outreachGifts: pick(full.outreachGifts),
    batch2OffersArchive: pick(full.batch2OffersArchive),
    outreachVariantsArchive: pick(full.outreachVariantsArchive),
    linkedinVariantsArchive: pick(full.linkedinVariantsArchive),
    nightlyFocus: thin(full.nightlyFocus),
    nightlyOffers: pick(full.nightlyOffers),
    nightlyLatest: full.nightlyLatest,
  };
}
