/** What kind of problem holds an email back, which decides the fix offered next to it. */
export type BlockKind = "address" | "identity" | "other";
export type BlockedGroup<T> = { reason: string; kind: BlockKind; emails: T[] };

export function blockKind(reason: string): BlockKind {
  if (/address|e-?mail|bounce|deliver/i.test(reason)) return "address";
  if (/identity|buyer|contact|person|name/i.test(reason)) return "identity";
  return "other";
}

/** Held emails grouped by the reason the morning run gives, address problems first, then the biggest groups. */
export function blockedGroups<T extends { reason: string | null }>(emails: T[]): BlockedGroup<T>[] {
  const groups = new Map<string, BlockedGroup<T>>();
  for (const email of emails) {
    const text = (email.reason ?? "").trim() || "held by the morning run";
    const reason = text.charAt(0).toUpperCase() + text.slice(1);
    const group = groups.get(reason.toLowerCase()) ?? { reason, kind: blockKind(reason), emails: [] };
    group.emails.push(email);
    groups.set(reason.toLowerCase(), group);
  }
  const rank = (kind: BlockKind) => (kind === "address" ? 0 : kind === "identity" ? 1 : 2);
  return [...groups.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || b.emails.length - a.emails.length || a.reason.localeCompare(b.reason));
}
