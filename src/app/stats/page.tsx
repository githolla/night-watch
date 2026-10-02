import { REPLY_MODEL } from "@/lib/reply-event";
import { ListOutcomes, VersionAnalytics } from "@/components/VersionAnalytics";
import { aggregateVersions, listOutcomeReport, suggestedMinFit, type ListedCard, type ListedCompany, type ListedTouch, type TrackedTouch } from "@/lib/version-analytics";
import { SECTORS } from "@/lib/list-sectors";
import { nightlyListConfig } from "@/lib/nightly-list-builder";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { SAVED_VERSION_MODEL } from "@/lib/version-attribution";
import Link from "next/link";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
type StatsData = { sent: number; replyRate: number; positiveShare: number; meetings: number; cost: number; groups: Array<{ name: string; sent: number; replyRate: number; positiveShare: number }> };
type ExperimentStats = { total: number; selected: number; sent: number; replied: number; positive: number; averageLift: number; confidence: number; winnerA: number; winnerB: number; dimensions: { relevance: number; specificity: number; trust: number; replyEase: number }; channels: Array<{ name: string; tests: number; averageLift: number; positive: number }>; recent: Array<{ id: string; person: string; company: string; channel: string; winner: string; scoreA: number; scoreB: number; status: string; date: string }> };
type Dimension = keyof ExperimentStats["dimensions"];
const emptyExperimentStats: ExperimentStats = { total: 0, selected: 0, sent: 0, replied: 0, positive: 0, averageLift: 0, confidence: 0, winnerA: 0, winnerB: 0, dimensions: { relevance: 0, specificity: 0, trust: 0, replyEase: 0 }, channels: [], recent: [] };

function StatsView({ stats, experiments, versions, lists }: { stats: StatsData; experiments: ExperimentStats; versions: React.ReactNode; lists: React.ReactNode }) {
  const completionRate = experiments.sent ? Math.round(experiments.replied / experiments.sent * 100) : 0;
  const positiveRate = experiments.replied ? Math.round(experiments.positive / experiments.replied * 100) : 0;
  return <div><main className="stats learning-page">
    <header className="learning-head"><div><div className="eyebrow">Learning system · message optimization</div><h1>What improves response</h1><p>Compare saved email versions using recorded sends, open signals and human replies.</p></div><Link href="/desk" className="learning-cta">Choose a saved version <span>→</span></Link></header>
    <nav className="learning-nav"><a href="#saved-versions">Saved versions</a><a href="#list-outcomes">List outcomes</a><a href="#experiments"><span>01</span>Message experiments</a><a href="#signals"><span>02</span>Signal performance</a></nav>

    {versions}
    {lists}
    <section id="experiments" className="experiment-analytics">
      <div className="analytics-section-head"><div><span className="eyebrow">Message Lab analytics</span><h2>Simulation → selection → outcome</h2></div><span>{experiments.total} TESTS RECORDED</span></div>
      <div className="experiment-metrics">
        <div><span>Tests run</span><strong>{experiments.total}</strong><small>{experiments.selected} winners selected</small></div>
        <div><span>Predicted lift</span><strong>+{experiments.averageLift}</strong><small>Average score points</small></div>
        <div><span>Observed replies</span><strong>{completionRate}%</strong><small>{experiments.replied} of {experiments.sent} sent variants</small></div>
        <div><span>Positive share</span><strong>{positiveRate}%</strong><small>Of actual replies</small></div>
      </div>

      {experiments.total ? <>
        <div className="analytics-grid">
          <section className="analytics-panel dimension-panel"><header><div><span className="eyebrow">Selected copy profile</span><h3>Where winning messages are strongest</h3></div><b>{experiments.confidence}% AVG CONFIDENCE</b></header><div className="dimension-list">{(Object.keys(experiments.dimensions) as Dimension[]).map((dimension, index) => <div key={dimension}><span><i>0{index + 1}</i>{dimension === "replyEase" ? "Reply ease" : dimension}</span><b><i style={{ width: `${experiments.dimensions[dimension]}%` }} /></b><strong>{experiments.dimensions[dimension]}</strong></div>)}</div><p>These are simulation scores for variants that were selected—not observed conversion rates.</p></section>
          <section className="analytics-panel outcome-panel"><header><span className="eyebrow">Observed outcome funnel</span><h3>What happened after selection</h3></header><div className="outcome-funnel"><div><strong>{experiments.selected}</strong><span>Selected</span></div><i /><div><strong>{experiments.sent}</strong><span>Sent</span></div><i /><div><strong>{experiments.replied}</strong><span>Replied</span></div><i /><div><strong>{experiments.positive}</strong><span>Positive</span></div></div><div className="winner-split"><div><span>Control A chosen</span><strong>{experiments.winnerA}</strong></div><div><span>Challenger B chosen</span><strong>{experiments.winnerB}</strong></div></div></section>
        </div>

        <div className="channel-learning"><div className="analytics-section-head compact"><div><span className="eyebrow">By surface</span><h2>Where testing changes the message</h2></div></div><div className="channel-cards">{experiments.channels.map((channel, index) => <article key={channel.name}><span>0{index + 1}</span><div><strong>{channel.name}</strong><small>{channel.tests} experiments</small></div><b>+{channel.averageLift}<small>AVG LIFT</small></b><em>{channel.positive} positive</em></article>)}</div></div>

        <div className="experiment-ledger"><div className="analytics-section-head compact"><div><span className="eyebrow">Recent room decisions</span><h2>Latest experiments</h2></div><span>PREDICTION AND ACTUALS</span></div><div className="experiment-table"><div className="experiment-row table-head"><span>Prospect</span><span>Channel</span><span>Scores</span><span>Winner</span><span>Outcome</span><span>Run</span></div>{experiments.recent.map((experiment) => <div className="experiment-row" key={experiment.id}><div><strong>{experiment.person}</strong><small>{experiment.company}</small></div><span>{experiment.channel}</span><div className="variant-scores"><i>A {experiment.scoreA}</i><i>B {experiment.scoreB}</i></div><b>{experiment.winner}</b><span>{experiment.status}</span><time>{experiment.date}</time></div>)}</div></div>
      </> : <div className="empty-experiments"><span>00</span><div><h3>No simulations recorded yet</h3><p>Open a person in the Morning Desk and choose “Run A/B simulation” in the message composer.</p></div><Link href="/desk">Open Morning Desk →</Link></div>}
    </section>

    <section id="signals" className="signal-analytics"><div className="analytics-section-head"><div><span className="eyebrow">Last 30 runs</span><h2>Signal performance</h2></div><span>EMAIL + MANUAL OUTREACH</span></div><div className="metrics"><div className="metric">Recorded touches<strong>{stats.sent}</strong></div><div className="metric">Reply rate<strong>{stats.replyRate}%</strong></div><div className="metric">Positive share<strong>{stats.positiveShare}%</strong></div><div className="metric">Meetings<strong>{stats.meetings}</strong></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Signal type</th><th>Touches</th><th>Reply rate</th><th>Positive share</th></tr></thead><tbody>{stats.groups.map((group) => <tr key={group.name}><td>{group.name}</td><td>{group.sent}</td><td>{group.replyRate}%</td><td>{group.positiveShare}%</td></tr>)}{!stats.groups.length && <tr><td colSpan={4} className="cell-empty">No recorded touches yet.</td></tr>}</tbody></table></div><p className="model-spend">Estimated model spend: ${stats.cost.toFixed(2)}</p></section>
  </main></div>;
}

export default async function Stats({ searchParams }: { searchParams: Promise<{ source?: string; days?: string; group?: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  // Check the schema while sign-in is checked, instead of one round trip after it.
  const schemaCheck = pendingMigrations(admin()).catch(() => []);
  await requireUser();
  {
    const pending = await schemaCheck;
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  const db = admin();
  const params = await searchParams;
  const source = params.source === "manual" || params.source === "all" ? params.source : "gmail";
  const days = params.days === "30" || params.days === "90" ? params.days : "all";
  const group = params.group === "sender" || params.group === "fit" ? params.group : "version";
  const since = days === "all" ? undefined : reportSince(Number(days));
  const listRead = loadListOutcomes(db);
  listRead.catch(() => {});
  // Every read on this page is independent, so they all start now. Touches are paged: one unpaged read
  // stops at 1,000 rows and the reply rate quietly covered only the first thousand sends.
  const trackedRead = fetchAll<TrackedTouch>((from,to)=>db.from("touches").select("id,card_id,person_id,sent_by,sent_at,gmail_thread_id,reply_at,reply_classification,people(full_name),message_variants(subject,dimensions,message_experiments(context))").in("channel",["email","linkedin_message"]).order("id").range(from,to) as unknown as PromiseLike<{ data: TrackedTouch[] | null; error: { message: string } | null }>);
  trackedRead.catch(() => {});
  const experimentsRead = loadExperimentStats(db);
  type OutcomeTouch = { reply_at: string | null; reply_classification: string; channel: string; cards: unknown };
  const [touches, { count: meetings }, { data: runs }] = await Promise.all([
    fetchAll<OutcomeTouch>((from, to) => db.from("touches").select("reply_at,reply_classification,channel,cards(signals(type),people(level))").order("id").range(from, to) as unknown as PromiseLike<{ data: OutcomeTouch[] | null; error: { message: string } | null }>),
    db.from("cards").select("*", { count: "exact", head: true }).eq("status", "meeting"),
    db.from("runs").select("cost_usd").order("started_at", { ascending: false }).limit(30),
  ]);
  const sent = touches?.length ?? 0, replied = touches?.filter((touch) => Boolean(touch.reply_at) && ["positive","neutral","objection","referral","negative"].includes(touch.reply_classification ?? "")).length ?? 0, positive = touches?.filter((touch) => ["positive", "referral"].includes(touch.reply_classification)).length ?? 0;
  const groups = new Map<string, { sent: number; replies: number; positive: number }>();
  for (const touch of touches ?? []) { const type = ((touch.cards as unknown as { signals: { type: string } })?.signals?.type) ?? "unknown", group = groups.get(type) ?? { sent: 0, replies: 0, positive: 0 }; group.sent++; if (Boolean(touch.reply_at) && ["positive","neutral","objection","referral","negative"].includes(touch.reply_classification ?? "")) group.replies++; if (["positive", "referral"].includes(touch.reply_classification)) group.positive++; groups.set(type, group); }
  const stats = { sent, replyRate: sent ? Math.round(replied / sent * 100) : 0, positiveShare: replied ? Math.round(positive / replied * 100) : 0, meetings: meetings ?? 0, cost: (runs ?? []).reduce((sum, run) => sum + Number(run.cost_usd), 0), groups: [...groups].map(([name, group]) => ({ name: name.replaceAll("_", " "), sent: group.sent, replyRate: group.sent ? Math.round(group.replies / group.sent * 100) : 0, positiveShare: group.replies ? Math.round(group.positive / group.replies * 100) : 0 })) };
  let listData: Awaited<typeof listRead> | null = null;
  let listError: string | undefined;
  try { listData = await listRead; } catch (error) { listError = error instanceof Error ? error.message : "Database unavailable"; }
  let summary = aggregateVersions([]);
  let trackingError: string | undefined;
  try {
    const tracked = await trackedRead;
    summary = aggregateVersions(tracked, { source, since, groupBy: group === "version" ? undefined : group, fitScoreByCard: listData?.fitScoreByCard });
  } catch (error) { trackingError = error instanceof Error ? error.message : "Database unavailable"; }
  const minFit = nightlyListConfig().minFit;
  const listReport = listData ? listOutcomeReport(listData.companies, listData.cards, listData.touches, { since, sectorLabels: SECTORS }) : null;
  const lists = <ListOutcomes report={listReport} error={listError} days={days} minFit={minFit} suggested={listReport ? suggestedMinFit(listReport, minFit) : null} />;
  return <StatsView stats={stats} experiments={await experimentsRead} lists={lists} versions={<VersionAnalytics summary={summary} error={trackingError} source={source} days={days} group={group} />} />;
}

/** Listed companies, their cards and every email touch on those cards, for the List outcomes section. */
async function loadListOutcomes(db: ReturnType<typeof admin>) {
  type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  const companies = await fetchAll<ListedCompany>((from, to) => db.from("list_candidates").select("domain,sector_key,fit_score,fit").eq("status", "listed").order("domain").range(from, to) as unknown as Page<ListedCompany>);
  const domains = companies.map((company) => company.domain);
  const cards: ListedCard[] = [];
  const touches: ListedTouch[] = [];
  for (let index = 0; index < domains.length; index += 200) {
    const chunk = domains.slice(index, index + 200);
    const rows = await fetchAll<{ id: string; status: string | null; meeting_at: string | null; qualified_at: string | null; opportunity_at: string | null; accounts: { domain: string } }>((from, to) => db.from("cards").select("id,status,meeting_at,qualified_at,opportunity_at,accounts!inner(domain)").in("accounts.domain", chunk).order("id").range(from, to) as unknown as Page<{ id: string; status: string | null; meeting_at: string | null; qualified_at: string | null; opportunity_at: string | null; accounts: { domain: string } }>);
    cards.push(...rows.map(({ accounts, ...card }) => ({ ...card, domain: accounts.domain })));
  }
  const cardIds = cards.map((card) => card.id);
  for (let index = 0; index < cardIds.length; index += 200) {
    const chunk = cardIds.slice(index, index + 200);
    touches.push(...await fetchAll<ListedTouch>((from, to) => db.from("touches").select("card_id,channel,sent_at,reply_classification").in("card_id", chunk).not("sent_at", "is", null).order("id").range(from, to) as unknown as Page<ListedTouch>));
  }
  const fitByDomain = new Map(companies.map((company) => [company.domain.toLowerCase(), company.fit_score]));
  const fitScoreByCard = new Map<string, number>();
  for (const card of cards) { const score = fitByDomain.get(card.domain.toLowerCase()); if (typeof score === "number") fitScoreByCard.set(card.id, score); }
  return { companies, cards, touches, fitScoreByCard };
}

async function loadExperimentStats(db: ReturnType<typeof admin>): Promise<ExperimentStats> {
  const { data: experiments } = await db.from("message_experiments").select("id,created_at,channel,status,predicted_winner,selected_label,confidence,cards(people(full_name),accounts(name))").neq("model", SAVED_VERSION_MODEL).neq("model", REPLY_MODEL).order("created_at", { ascending: false }).limit(100);
  if (!experiments?.length) return emptyExperimentStats;
  const ids = experiments.map((experiment) => experiment.id);
  const { data: variants } = await db.from("message_variants").select("id,experiment_id,label,simulation_score,dimensions,selected").in("experiment_id", ids);
  const variantIds = (variants ?? []).map((variant) => variant.id);
  const { data: experimentTouches } = variantIds.length ? await db.from("touches").select("experiment_variant_id,reply_classification,sent_at,reply_at").in("experiment_variant_id", variantIds) : { data: [] };
  const pairs = new Map<string, Array<{ id: string; label: string; score: number; selected: boolean; dimensions: Record<string, number> }>>();
  for (const variant of variants ?? []) { const list = pairs.get(variant.experiment_id) ?? []; list.push({ id: variant.id, label: variant.label, score: variant.simulation_score ?? 0, selected: variant.selected, dimensions: (variant.dimensions ?? {}) as Record<string, number> }); pairs.set(variant.experiment_id, list); }
  const selectedVariants = [...pairs.values()].flat().filter((variant) => variant.selected);
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const experimentSent = experimentTouches?.length ?? 0;
  const experimentReplied = experimentTouches?.filter((touch) => Boolean(touch.reply_at) && ["positive","neutral","objection","referral","negative"].includes(touch.reply_classification ?? "")).length ?? 0;
  const experimentPositive = experimentTouches?.filter((touch) => ["positive", "referral"].includes(touch.reply_classification)).length ?? 0;
  const lifts = [...pairs.values()].filter((pair) => pair.length === 2).map((pair) => Math.abs(pair[0].score - pair[1].score));
  const channels = ["email", "comment", "connection"].map((channel) => { const channelExperiments = experiments.filter((experiment) => experiment.channel === channel), channelLifts = channelExperiments.map((experiment) => { const pair = pairs.get(experiment.id) ?? []; return pair.length === 2 ? Math.abs(pair[0].score - pair[1].score) : 0; }), channelVariantIds = new Set(channelExperiments.flatMap((experiment) => (pairs.get(experiment.id) ?? []).map((variant) => variant.id))), channelPositive = (experimentTouches ?? []).filter((touch) => channelVariantIds.has(touch.experiment_variant_id) && ["positive", "referral"].includes(touch.reply_classification)).length; return { name: channel === "email" ? "Email" : channel === "comment" ? "Post reply" : "Connection note", tests: channelExperiments.length, averageLift: average(channelLifts), positive: channelPositive }; }).filter((channel) => channel.tests > 0);
  const touchByVariant = new Map((experimentTouches ?? []).map((touch) => [touch.experiment_variant_id, touch]));
  return {
    total: experiments.length, selected: experiments.filter((experiment) => experiment.selected_label).length, sent: experimentSent, replied: experimentReplied, positive: experimentPositive, averageLift: average(lifts), confidence: average(experiments.map((experiment) => experiment.confidence ?? 0)), winnerA: experiments.filter((experiment) => experiment.predicted_winner === "A").length, winnerB: experiments.filter((experiment) => experiment.predicted_winner === "B").length,
    dimensions: { relevance: average(selectedVariants.map((variant) => variant.dimensions.relevance ?? 0)), specificity: average(selectedVariants.map((variant) => variant.dimensions.specificity ?? 0)), trust: average(selectedVariants.map((variant) => variant.dimensions.trust ?? 0)), replyEase: average(selectedVariants.map((variant) => variant.dimensions.replyEase ?? 0)) }, channels,
    recent: experiments.slice(0, 8).map((experiment) => { const pair = pairs.get(experiment.id) ?? [], selected = pair.find((variant) => variant.selected), touch = selected ? touchByVariant.get(selected.id) : undefined, card = experiment.cards as unknown as { people: { full_name: string }; accounts: { name: string } }; return { id: experiment.id, person: card?.people?.full_name ?? "Unknown", company: card?.accounts?.name ?? "Unknown", channel: experiment.channel === "email" ? "Email" : experiment.channel === "comment" ? "Post reply" : "Connection note", winner: (experiment.predicted_winner ?? "—") as string, scoreA: pair.find((variant) => variant.label === "A")?.score ?? 0, scoreB: pair.find((variant) => variant.label === "B")?.score ?? 0, status: touch ? ["positive", "referral"].includes(touch.reply_classification) ? "Positive reply" : touch.reply_classification === "none" ? "Sent · awaiting reply" : `${touch.reply_classification} reply` : experiment.selected_label ? "Selected" : "Simulated", date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(experiment.created_at)) }; }),
  };
}

function reportSince(days: number) { return new Date(Date.now() - days * 86400000).toISOString(); }
