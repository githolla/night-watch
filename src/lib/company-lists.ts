/** How far one company got: each company counts once, at its furthest step. */
export type CompanyStage = "meeting" | "positive" | "sent" | "ready" | "review" | "missing" | "closed";
export type ListCard = { domain: string; status: string; held: boolean; sendable: boolean; positiveReply: boolean };
export type ListRow = { domain: string; sector: string };
export type ListSummary = {
  date: string; building: boolean; companies: number; sectors: string[];
  /** A few of its companies, for their logos. */
  logos: string[];
  progress: Record<"sent" | "ready" | "review" | "missing", number>;
  positive: number; meetings: number;
  status: "Preparing" | "Active" | "Done";
  next: "wait" | "review" | "contacts" | "results";
};

const BOOKED = ["meeting", "qualified", "opportunity"];
const UNSENT = ["new", "edited", "approved"];

/** The furthest any of a company's cards got; a reply counts above a send, a booking above both. */
export function companyStage(cards: ListCard[]): CompanyStage {
  if (cards.some((card) => BOOKED.includes(card.status))) return "meeting";
  if (cards.some((card) => card.positiveReply)) return "positive";
  if (cards.some((card) => !UNSENT.includes(card.status) && !["dismissed", "archived", "snoozed"].includes(card.status))) return "sent";
  const open = cards.filter((card) => UNSENT.includes(card.status));
  if (open.some((card) => card.sendable && !card.held && card.status === "approved")) return "ready";
  if (open.some((card) => card.sendable)) return "review";
  if (open.length) return "missing";
  return "closed";
}

/** One nightly list: its companies, how far outreach got, what came back and the next useful step. */
export function summarizeList(list: { date: string; building: boolean; rows: ListRow[] }, cards: ListCard[]): ListSummary {
  const byDomain = new Map<string, ListCard[]>();
  for (const card of cards) byDomain.set(card.domain.toLowerCase(), [...(byDomain.get(card.domain.toLowerCase()) ?? []), card]);
  const domains = [...new Set(list.rows.map((row) => row.domain.toLowerCase()))];
  const stages = domains.map((domain) => companyStage(byDomain.get(domain) ?? []));
  const count = (...wanted: CompanyStage[]) => stages.filter((stage) => wanted.includes(stage)).length;
  const progress = { sent: count("sent", "positive", "meeting"), ready: count("ready"), review: count("review"), missing: count("missing") };
  const tally = new Map<string, number>();
  for (const row of list.rows) if (row.sector && row.sector !== "Other") tally.set(row.sector, (tally.get(row.sector) ?? 0) + 1);
  const open = progress.ready + progress.review + progress.missing;
  return {
    date: list.date, building: list.building, companies: domains.length, logos: domains.slice(0, 4),
    sectors: [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sector]) => sector),
    progress, positive: count("positive", "meeting"), meetings: count("meeting"),
    status: list.building ? "Preparing" : open ? "Active" : "Done",
    next: list.building ? "wait" : progress.review ? "review" : progress.missing ? "contacts" : "results",
  };
}
