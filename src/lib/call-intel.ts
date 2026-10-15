import profiles from "../../data/call-company-profiles.json" with { type: "json" };

export type IntelFact = { text: string; url: string | null; date?: string | null };
export type CallQuestion = { title: string; ask: string; followups: string[]; listenFor: string[]; goal: string; context: IntelFact[] };
export type CompanyIntel = {
  overview: string | null;
  products: string[];
  customers: string[];
  operations: string | null;
  sourceUrl: string | null;
  checkedAt: string | null;
  productHeading: string;
  evidence: Array<{ title: string; facts: IntelFact[] }>;
  questions: string[];
  questionCards: CallQuestion[];
  listenFor: string[];
  roleAngle: string;
  gaps: string[];
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const url = (value: unknown): string | null => { try { const parsed = new URL(String(value)); return parsed.protocol === "https:" ? parsed.href : null; } catch { return null; } };

const playbooks: Record<string, { questions: string[]; listenFor: string[] }> = {
  manufacturing: { questions: ["Are orders standard products, configured products, or engineered to order?", "Where do engineering changes, materials shortages or quality holds require manual coordination?", "Which production or customer reports are still assembled outside your core systems?"], listenFor: ["Re-entering specifications or bills of materials", "Chasing quality documents and approvals", "Expediting orders because status is hard to see"] },
  distribution: { questions: ["What do you stock versus source or ship directly from suppliers?", "Where do quotes, substitutions and supplier lead times require manual follow-up?", "How do purchasing, warehouse and sales teams share order exceptions?"], listenFor: ["Supplier files copied into ERP", "Manual stock or price checks", "Order exceptions tracked in separate spreadsheets"] },
  logistics: { questions: ["Which shipments or warehouse activities create the most exceptions?", "How do dispatch, warehouse teams and customers share an updated ETA?", "How does proof of delivery become a billable record?"], listenFor: ["Rekeying shipment documents", "Calls to find order status", "Missing delivery evidence delaying billing"] },
  landscape: { questions: ["How do site observations become scheduled work and customer updates?", "Which handoffs between estimating, crews and account managers need the most checking?", "How do you know that promised work was completed across sites?"], listenFor: ["Photos and notes scattered across messages", "Managers assembling branch reports", "Changes lost between estimate and crew instructions"] },
  nursery: { questions: ["How do you track plant availability and committed customer orders?", "How are substitutions, loading and delivery changes coordinated?", "Which production or inventory reports need manual reconciliation?"], listenFor: ["Availability lists updated by hand", "Substitutions requiring several calls", "Mismatches between growing inventory and orders"] },
  pest: { questions: ["How do inspection findings become the treatment plan and follow-up visit?", "How do you coordinate recurring routes with callbacks and urgent requests?", "Which technician records need office cleanup before billing or customer reporting?"], listenFor: ["Repeated intake between service lines", "Dispatchers rebuilding schedules manually", "Treatment notes and customer promises not connected"] },
  construction: { questions: ["How do scope changes get from estimating to the team doing the work?", "How does completed field work become an approved billing record?", "Where do project teams chase documents, approvals or material status?"], listenFor: ["Manual change-order reconciliation", "Photos and quantities missing from progress claims", "Multiple versions of the scope"] },
  restaurant: { questions: ["Which store exceptions need area-manager attention each morning?", "How do managers reconcile inventory, labor and sales information?", "Which recurring reports take time away from store coaching?"], listenFor: ["Store reports consolidated by hand", "Invoices or stock discrepancies chased by email", "Actions lost after an area review"] },
  facilities: { questions: ["How do site inspections become assigned work and proof of completion?", "How are urgent customer requests routed to the right service team?", "Which reports or invoices require manual assembly across locations?"], listenFor: ["Requests arriving through several channels", "Supervisors chasing completion evidence", "Separate site spreadsheets"] },
  "field-service": { questions: ["How do you coordinate jobs needing more than one trade?", "How do dispatchers handle overruns without losing customer commitments?", "What must the office check after a technician finishes before billing?"], listenFor: ["Repeated intake across teams", "Manual rescheduling and customer updates", "Incomplete job notes delaying invoices"] },
  general: { questions: ["What products or services account for most of the work today?", "Which recurring process crosses the most teams or systems?", "Where does someone still collect information manually before the next step can happen?"], listenFor: ["Repeated data entry", "Manual approvals and status chasing", "Reports assembled from disconnected tools"] },
};

export function buildCompanyIntel(input: { domain: string; sector?: string | null; title: string; row?: unknown; dossier?: unknown }): CompanyIntel {
  const curated = profiles.find(item => item.domain === input.domain.toLowerCase().replace(/^www\./, ""));
  const stored = record(record(input.row).businessProfile);
  const dynamic = text(stored.overview) && url(stored.sourceUrl) ? { overview: String(stored.overview), products: list(stored.products).flatMap(item => text(item) ? [String(item)] : []), customers: list(stored.customers).flatMap(item => text(item) ? [String(item)] : []), operations: text(stored.operations) ?? "", sourceUrl: url(stored.sourceUrl)!, checkedAt: text(stored.checkedAt) ?? "", industry: "", question: "" } : null;
  const profile = dynamic && (!curated || dynamic.checkedAt > curated.checkedAt) ? dynamic : curated;
  const row = record(input.row), dossier = record(input.dossier), brief = record(dossier.brief);
  const business = record(brief.company_profile);
  const sector = input.sector?.toLowerCase() ?? "";
  const kind = profile?.industry || (/manufactur|fabricat/.test(sector) ? "manufacturing" : /distribut|wholesale/.test(sector) ? "distribution" : /logistic|warehouse|freight|trucking/.test(sector) ? "logistics" : /landscap/.test(sector) ? "landscape" : /pest/.test(sector) ? "pest" : /construct|roof/.test(sector) ? "construction" : /restaurant/.test(sector) ? "restaurant" : /hvac|plumbing|electrical/.test(sector) ? "field-service" : /janitorial|facilit/.test(sector) ? "facilities" : "general");
  const book = playbooks[kind] ?? playbooks.general;
  const reasons = list(record(row.aiFit).reasons).map(record).filter(item => typeof item.points === "number" && item.points > 0);
  const sections = [
    { title: "Operating footprint", key: "scale" },
    { title: "Systems already in place", key: "systems" },
    { title: "Hiring signals", key: "hiring" },
    { title: "Business changes", key: "change" },
    { title: "Technology approach", key: "techOpenness" },
  ].map(section => ({ title: section.title, facts: reasons.filter(item => item.criterion === section.key && text(item.text) && url(item.url)).map(item => ({ text: String(item.text), url: url(item.url) })) })).filter(section => section.facts.length);
  const facts = list(record(dossier.dossier).facts).map(record).flatMap(item => text(item.statement) && url(item.source_url) ? [{ text: String(item.statement), url: url(item.source_url), date: text(item.published_date) }] : []);
  if (facts.length) sections.push({ title: "Additional researched facts", facts: facts.slice(0, 6) });
  const overview = profile?.overview ?? text(business.what_they_do);
  const products = profile?.products ?? [];
  const customers = profile?.customers ?? [];
  const gaps = [!overview ? "Company activity needs more research." : null, !products.length ? "Specific products or service lines have not been recorded." : null, !customers.length ? "Customer segments have not been confirmed." : null, !sections.some(item => item.title === "Systems already in place") ? "Installed business systems are not confirmed. Ask before proposing integrations." : null].filter((item): item is string => Boolean(item));
  const systems = sections.find(section => section.title === "Systems already in place")?.facts ?? [];
  const questionCards: CallQuestion[] = [
    { title: "The workflow", ask: profile?.question || book.questions[0], followups: ["Could you walk me through the most recent example?", "Who takes it from the initial request through to completion?", products.length ? `Which of your service or product lines, such as ${products.slice(0, 2).join(" or ")}, makes that process most complex?` : "Which type of work makes that process most complex?"], listenFor: [book.listenFor[0]], goal: "Understand a real example before proposing a change.", context: profile ? [{ text: profile.overview, url: profile.sourceUrl }] : [] },
    { title: "Where it gets stuck", ask: book.questions[1], followups: ["What happens when that step does not go to plan?", "Who notices the exception, and who has to resolve it?", "Does it cause delays, rework, missed commitments or something else?"], listenFor: [book.listenFor[1]], goal: "Find the exception worth solving and the person responsible for it.", context: [] },
    { title: "Tools & manual work", ask: book.questions[2], followups: [systems.length ? "Which parts are already handled well by your existing systems?" : "Which systems do you use for that work today?", "Where does someone still copy information, check a spreadsheet or chase an update?", "What needs human judgment, and what is just repetitive preparation?"], listenFor: [book.listenFor[2]], goal: "Identify a useful gap around existing tools rather than assuming they need replacing.", context: systems },
    { title: "A useful first project", ask: "If we improved one small part of that process, what would make it worthwhile for your team?", followups: ["How often does it happen, and roughly how much time does it take?", "What would you measure in a first trial: turnaround time, checking effort, errors or another outcome?", "Who runs this process day to day, and would it make sense to include them in a short follow-up?"], listenFor: ["A measurable recurring task", "A named workflow owner", "A concrete next step with a date"], goal: "Agree on a small test and the right next conversation, if there is a fit.", context: [] },
  ];
  return {
    overview, products, customers, operations: profile?.operations ?? text(business.hq), sourceUrl: profile?.sourceUrl ?? null,
    checkedAt: profile?.checkedAt ?? text(record(brief.verification).checked_on) ?? text(row.researchDate),
    productHeading: kind === "manufacturing" ? "What they manufacture" : kind === "distribution" ? "What they distribute" : kind === "nursery" ? "What they grow & deliver" : "What they sell & deliver",
    evidence: sections,
    questions: [...new Set([...(profile?.question ? [profile.question] : []), ...book.questions])],
    questionCards,
    listenFor: book.listenFor,
    roleAngle: /operations|\bcoo\b|general manager/i.test(input.title) ? "Explore cross-team handoffs, exceptions and time spent coordinating. Ask which manager owns the workflow." : /ceo|president|owner|founder/i.test(input.title) ? "Ask which operational constraint deserves attention, then identify the person who runs that process day to day." : "Confirm their responsibility for this workflow and ask who else should join a follow-up.",
    gaps,
  };
}
