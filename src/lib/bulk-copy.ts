/** Replace just the first prose paragraph; retain the recipient greeting and the rest. */
export function replaceOpening(body:string,opening:string):string {
 const parts=body.trim().split(/\n\s*\n/);
 const greeting=/^(?:hi|hello|hey|dear|greetings|good morning|good afternoon|good evening)\b[^\n.!?]*[,!]?$|^[\p{L}'-]+,$/iu;
 if(greeting.test(parts[0]?.trim()??'')){
  return [parts[0],opening.trim(),...parts.slice(2)].join('\n\n');
 }
 // Some older drafts have only one newline after the greeting.
 const lines=(parts[0]??'').split('\n');
 if(lines.length>1&&greeting.test(lines[0].trim()))return [lines[0],opening.trim(),...parts.slice(1)].join('\n\n');
 return [opening.trim(),...parts.slice(1)].join('\n\n');
}

/** The ways a draft names its company: the full account name, the part before " / ", and that without a
 *  legal suffix. Longest first, so the most specific form is replaced. */
const companyForms = (name: string | null | undefined) => {
  const full = (name ?? "").trim();
  const head = full.split(" / ")[0].trim();
  const bare = head.replace(/,?\s+(?:inc\.?|llc|l\.l\.c\.|co\.?|corp\.?|corporation|company|ltd\.?)$/i, "").trim();
  return [...new Set([full, head, bare].filter(form => form.length >= 3))];
};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Copy one draft's subject or message onto another company's draft: that company's name, and in a message
 *  the greeting's first name, are swapped in so a batch edit never sends one company's name to another. */
export function retargetCopy(text: string, from: { company: string | null | undefined; person: string | null | undefined }, to: { company: string | null | undefined; person: string | null | undefined }, isMessage: boolean) {
  let out = text;
  const fromForms = companyForms(from.company), toForms = companyForms(to.company);
  for (let index = 0; index < fromForms.length; index++) {
    const form = fromForms[index];
    if (!out.includes(form)) continue;
    const replacement = toForms[Math.min(index, toForms.length - 1)];
    if (replacement && replacement !== form) out = out.split(form).join(replacement);
    break;
  }
  if (isMessage) {
    const fromFirst = (from.person ?? "").trim().split(/\s+/)[0], toFirst = (to.person ?? "").trim().split(/\s+/)[0];
    if (fromFirst && toFirst && fromFirst !== toFirst) out = out.replace(new RegExp(`^((?:hi|hello|hey|dear|good morning|good afternoon)\\s+)${escapeRegExp(fromFirst)}\\b`, "i"), `$1${toFirst}`);
  }
  return out;
}

const GENERIC_NAME_WORDS = new Set(["inc", "llc", "co", "corp", "ltd", "llp", "pllc", "group", "groups", "service", "services", "company", "companies", "corporation", "incorporated", "enterprises", "enterprise", "industries", "holdings", "international", "solutions", "systems", "partners", "associates", "construction", "contractors", "contracting", "management", "technologies", "technology", "products", "manufacturing", "distribution", "national", "american", "control", "pest", "the", "and"]);
const nameWords = (text: string) => (text.match(/[\p{L}][\p{L}'-]*/gu) ?? []);

/**
 * What in a retargeted copy still points at the source draft: a distinctive word of the source company's
 * name, or the source contact's first name, written as a name (capitalised, not just starting a sentence)
 * that the target's own name does not share. Copying "ABC" into 24 other companies' emails because the
 * account is filed as "ABC Holdings LLC" must be caught before saving, without tripping on "a great fit"
 * because one company is called Great Lakes.
 */
export function leftoverSourceNames(text: string, from: { company: string | null | undefined; person: string | null | undefined }, to: { company: string | null | undefined; person: string | null | undefined }) {
  const targetWords = new Set([...nameWords(to.company ?? ""), ...nameWords(to.person ?? "")].map(word => word.toLowerCase()));
  const companyWords = nameWords(from.company ?? "").filter(word => word.length >= 3 && !GENERIC_NAME_WORDS.has(word.toLowerCase()));
  const first = nameWords(from.person ?? "")[0];
  const candidates = [...new Set([...companyWords, ...(first && first.length >= 2 ? [first] : [])])].filter(word => !targetWords.has(word.toLowerCase()));
  const asName = (word: string) => {
    const capitalised = word.charAt(0).toUpperCase() + word.slice(1);
    const pattern = new RegExp(`(^|[^\\p{L}])(${capitalised.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}])`, "gu");
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(0, (match.index ?? 0) + match[1].length).trimEnd();
      // A capitalised word that only starts a sentence or the email is ordinary prose, not a name.
      if (before === "" || /[.!?:]$/.test(before) || /,$/.test(before) && /^(?:hi|hello|hey|dear)$/i.test(before.slice(0, -1).trim().split(/\s+/).at(-1) ?? "")) { if (word !== first) continue; }
      return true;
    }
    return false;
  };
  return candidates.filter(asName).map(word => word.toLowerCase());
}
