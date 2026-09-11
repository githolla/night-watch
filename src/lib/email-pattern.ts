/**
 * Work-email address formats. Given a few known addresses at a domain the
 * format is usually obvious (john.smith@, jsmith@, john@); once known, an
 * address can be built for anyone else on file there. Built addresses are
 * stored as unverified and the send guard keeps them out of automatic
 * sends; they are for the person working the list, who can verify by hand.
 */
export type PatternKey = "first.last" | "firstlast" | "flast" | "first_last" | "first-last" | "first" | "f.last" | "firstl" | "last.first" | "lastfirst" | "last" | "first.l";

export const PATTERN_KEYS: PatternKey[] = ["first.last", "flast", "firstlast", "first", "first_last", "f.last", "firstl", "first-last", "last.first", "lastfirst", "first.l", "last"];

export const PATTERN_LABEL: Record<PatternKey, string> = {
  "first.last": "first.last", firstlast: "firstlast", flast: "flast", first_last: "first_last", "first-last": "first-last", first: "first",
  "f.last": "f.last", firstl: "firstl", "last.first": "last.first", lastfirst: "lastfirst", last: "last", "first.l": "first.l",
};

/** Mailboxes that are never a person. */
const GENERIC = /^(info|hello|hi|contact|press|media|pr|news|sales|support|help|careers|jobs|hr|recruiting|admin|office|team|marketing|billing|accounts?|legal|privacy|security|webmaster|noreply|no-reply|donotreply|enquiries|inquiries|general|mail|email|service|customerservice|orders?|partners?|investors?|ir)$/i;

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "ph.d.", "md", "cpa", "mba", "esq", "esq.", "cfa", "pmp", "pe", "rn", "cma", "jd"]);

function fold(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

/** First and last name from a display name, ignoring credentials and suffixes. */
export function splitName(fullName: string): { first: string; last: string } | null {
  const cleaned = fullName.split(",")[0].replace(/\(.*?\)/g, " ").replace(/["“”]/g, " ");
  const parts = cleaned.split(/\s+/).map((part) => part.trim()).filter((part) => part && !SUFFIXES.has(part.toLowerCase()));
  if (parts.length < 2) return null;
  const first = fold(parts[0]);
  const last = fold(parts[parts.length - 1]);
  if (first.length < 1 || last.length < 2) return null;
  return { first, last };
}

/** The local part an address would have under a pattern, or null when the name cannot be split. */
export function localPart(fullName: string, key: PatternKey): string | null {
  const name = splitName(fullName);
  if (!name) return null;
  const { first, last } = name;
  switch (key) {
    case "first.last": return `${first}.${last}`;
    case "firstlast": return `${first}${last}`;
    case "flast": return `${first[0]}${last}`;
    case "first_last": return `${first}_${last}`;
    case "first-last": return `${first}-${last}`;
    case "first": return first;
    case "f.last": return `${first[0]}.${last}`;
    case "firstl": return `${first}${last[0]}`;
    case "last.first": return `${last}.${first}`;
    case "lastfirst": return `${last}${first}`;
    case "last": return last;
    case "first.l": return `${first}.${last[0]}`;
  }
}

export function buildEmail(fullName: string, key: PatternKey, domain: string): string | null {
  const local = localPart(fullName, key);
  return local ? `${local}@${domain.toLowerCase()}` : null;
}

export type PatternGuess = { key: PatternKey; confidence: number; matched: number; samples: number };

/**
 * Which pattern the known addresses follow. Confidence grows with agreeing
 * samples: one address 0.6, two 0.8, three or more 0.95, minus disagreement.
 */
export function detectPattern(samples: Array<{ name: string; email: string }>, domain: string): PatternGuess | null {
  const usable = samples.filter((sample) => sample.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`) && !GENERIC.test(sample.email.split("@")[0]) && splitName(sample.name));
  if (!usable.length) return null;
  let best: PatternGuess | null = null;
  for (const key of PATTERN_KEYS) {
    const matched = usable.filter((sample) => localPart(sample.name, key) === sample.email.split("@")[0].toLowerCase()).length;
    if (!matched || (best && matched <= best.matched)) continue;
    const base = matched >= 3 ? 0.95 : matched === 2 ? 0.8 : 0.6;
    const disagreement = (usable.length - matched) / usable.length;
    best = { key, confidence: Math.max(0.2, Number((base * (1 - disagreement * 0.6)).toFixed(2))), matched, samples: usable.length };
  }
  return best;
}

/**
 * A weaker guess from bare addresses seen on public pages, with no name to
 * check against: a dot or underscore between two words says first.last;
 * a single long token is most often first initial plus last name.
 */
export function guessFromExamples(examples: string[], domain: string): PatternGuess | null {
  const locals = [...new Set(examples.map((email) => email.trim().toLowerCase()).filter((email) => email.endsWith(`@${domain.toLowerCase()}`)).map((email) => email.split("@")[0]).filter((local) => local && !GENERIC.test(local)))];
  if (!locals.length) return null;
  const votes = new Map<PatternKey, number>();
  for (const local of locals) {
    const key: PatternKey | null = /^[a-z]{2,}\.[a-z]{2,}$/.test(local) ? "first.last" : /^[a-z]{2,}_[a-z]{2,}$/.test(local) ? "first_last" : /^[a-z]{2,}-[a-z]{2,}$/.test(local) ? "first-last" : /^[a-z]\.[a-z]{2,}$/.test(local) ? "f.last" : /^[a-z]{2,}\.[a-z]$/.test(local) ? "first.l" : /^[a-z]{4,}$/.test(local) ? "flast" : null;
    if (key) votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  const [top] = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (!top) return null;
  return { key: top[0], confidence: top[1] >= 2 ? 0.55 : 0.4, matched: top[1], samples: locals.length };
}
