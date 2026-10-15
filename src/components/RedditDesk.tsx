"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { briefing, clusters, queryPlan, responseAllowed, score, statuses, type Opportunity, type RedditConfig } from "@/lib/reddit/domain";

type Run = { id: string; status: string; started_at: string; finished_at: string | null; report: Record<string, unknown> };
type Props = { config: RedditConfig; rows: Opportunity[]; runs: Run[]; access: { ready: boolean; missing: string[] }; owner: "josh" | "suuchi"; isAdmin: boolean; now: number };
async function request(body: unknown) {
  const response = await fetch("/api/reddit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(typeof data === "object" && data !== null && "error" in data ? String(data.error) : "Request failed.");
  return data;
}
function OpportunityCard({ row, config, owner, isAdmin, now }: { row: Opportunity; config: RedditConfig; owner: Props["owner"]; isAdmin: boolean; now: number }) {
  const router = useRouter();
  const [status, setStatus] = useState(row.status);
  const [seat, setSeat] = useState(row.owner ?? "");
  const [watched, setWatched] = useState(row.watched);
  const [followup, setFollowup] = useState(row.followup_at?.slice(0, 16) ?? "");
  const [notes, setNotes] = useState(row.notes);
  const [email, setEmail] = useState(row.contact?.email ?? "");
  const [consent, setConsent] = useState(row.contact?.consent_evidence ?? "");
  const [feedback, setFeedback] = useState(row.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const editable = !row.owner || row.owner === owner || isAdmin;
  const community = config.communities.find((item) => item.name.toLowerCase() === row.source.subreddit.toLowerCase());
  async function act(action: string) {
    setBusy(true); setMessage("");
    try {
      await request(action === "update" ? { action, id: row.id, patch: { version: row.version, status, owner: seat || null, watched, followup_at: followup ? `${followup}:00.000Z` : null, notes, feedback: feedback || null, contact: email ? { email, consent_evidence: consent } : null } } : { action, id: row.id, version: row.version });
      setMessage(action === "delete" ? "Deleted." : "Saved."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save."); }
    finally { setBusy(false); }
  }
  return <article className="card reddit-opportunity">
    <header><span>r/{row.source.subreddit} · {new Date(row.source.created_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })}</span><strong>{row.analysis ? `${score(row.analysis, row.source, now)}/100 · ${Math.round(row.analysis.confidence * 100)}% confidence` : "Awaiting analysis"}</strong></header>
    <h3><a href={row.source.permalink} target="_blank" rel="noopener noreferrer">{row.source.title}</a></h3>
    <div className="reddit-actions"><a className="btn-secondary" href={row.source.permalink} target="_blank" rel="noopener noreferrer" aria-label={`Open Reddit post: ${row.source.title}`}>Open original Reddit post ↗</a></div>
    <p>{row.analysis?.summary}</p><p>{row.analysis?.rationale}</p>
    {row.analysis?.evidence.map((evidence, index) => <blockquote key={index}><p>{evidence.quote}</p><small>{evidence.supports} · source {evidence.source_id}</small></blockquote>)}
    {row.analysis && <p><b>Still unknown:</b> {row.analysis.unknowns.join("; ") || "No additional unknowns recorded. Verify the thread before replying."}</p>}
    {row.source.comments_partial && <p className="reddit-warning">Thread text or comments are a bounded sample. Open the thread for full context.</p>}
    {row.source.locked && <p className="reddit-warning">This thread is locked or archived.</p>}
    <details><summary>Thread context and author clarifications</summary><p className="reddit-preserve">{row.source.text}</p>{row.source.comments.map((comment) => <blockquote key={comment.id}><small>{comment.is_author ? "Original poster" : "Community member"} · {comment.id}</small><p className="reddit-preserve">{comment.text}</p></blockquote>)}</details>
    <details><summary>Response draft and useful asset</summary>
      <p>{community?.response_policy === "helpful_only" ? "Check the current thread and rules before posting this yourself." : "Community rules need review before drafting a business reply."}</p>
      {row.draft ? <><p><b>{row.draft.approved ? "Critic passed. Human review required." : "Critic rejected this draft."}</b> {row.draft.critique}</p><p className="reddit-preserve">{row.draft.body}</p>{row.draft.approved && <button className="btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(row.draft!.body); setMessage("Draft copied. Review before posting."); } catch { setMessage("Clipboard unavailable. Select and copy the draft text."); } }}>Copy draft</button>}<p className="reddit-preserve"><b>Asset outline:</b> {row.draft.asset_outline}</p></> : <p><b>Suggested asset:</b> {row.analysis?.asset || "No asset suggested yet."}</p>}
      {isAdmin && <button className="btn-secondary" disabled={busy || !row.analysis || !responseAllowed(row.source, community, now)} onClick={() => act("draft")}>Generate reply and critic review</button>}
    </details>
    <details><summary>Conversation, owner and follow-up</summary><div className="reddit-fields">
      <label>Stage<select disabled={!editable} value={status} onChange={(event) => setStatus(event.target.value as Opportunity["status"])}>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label>Owner<select disabled={!editable} value={seat} onChange={(event) => setSeat(event.target.value)}><option value="">Unassigned</option><option value="josh">Josh</option><option value="suuchi">Suuchi</option></select></label>
      <label>Follow up at (UTC)<input disabled={!editable} type="datetime-local" value={followup} onChange={(event) => setFollowup(event.target.value)} /></label>
      <label>Relevance feedback<select disabled={!editable} value={feedback} onChange={(event) => setFeedback(event.target.value)}><option value="">Not reviewed</option><option value="relevant">Relevant</option><option value="irrelevant">Irrelevant</option></select></label>
    </div><label><input disabled={!editable} type="checkbox" checked={watched} onChange={(event) => setWatched(event.target.checked)} /> Watch for new comments</label>
      <label className="reddit-field">Conversation notes and reply permalink<textarea disabled={!editable} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <label className="reddit-field">Email voluntarily shared for a business conversation<input disabled={!editable} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="reddit-field">Where and how they gave permission to contact them<textarea disabled={!editable} value={consent} onChange={(event) => setConsent(event.target.value)} /></label>
      <p>Contact details stay in this conversation. Adding them does not start email outreach. Saved Reddit evidence and its derivatives expire under the retention setting.</p>
      <div className="reddit-actions"><button className="btn primary" disabled={busy || !editable} onClick={() => act("update")}>Save conversation</button><button className="btn-secondary" disabled={busy || !editable} onClick={() => { if (window.confirm("Delete this conversation, its evidence and saved drafts?")) void act("delete"); }}>Delete</button></div>
    </details>
    {message && <p role="status">{message}</p>}
  </article>;
}
export function RedditDesk({ config, rows, runs, access, owner, isAdmin, now }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState("briefing");
  const [settings, setSettings] = useState(config);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const brief = briefing(rows, owner, now);
  const selected = tab === "briefing" ? [...brief.actToday, ...brief.followup.filter((row) => !brief.actToday.some((item) => item.id === row.id))] : rows.filter((row) => (!stage || row.status === stage) && `${row.source.title} ${row.analysis?.summary ?? ""} ${row.source.subreddit}`.toLowerCase().includes(query.toLowerCase()));
  async function act(action: "run" | "configure") {
    setBusy(true); setMessage("");
    try { const result = await request(action === "configure" ? { action, config: settings } : { action }); setMessage(action === "configure" ? "Settings saved." : `Discovery finished. ${typeof result === "object" && result !== null && "status" in result ? String(result.status) : "Check coverage below."}`); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  }
  return <div className="reddit-desk">
    <section className="card reddit-overview"><h2>{config.enabled && access.ready ? "Nightly discovery configured" : "Collection is disabled"}</h2><p>Nightly run: 07:00 UTC, which is 2am or 3am Eastern. Search overlap: 72 hours. Replies are reviewed and posted by a person.</p>{!access.ready && <p>Setup needed: {access.missing.join(", ")}. The approval reference must cover this commercial use and analysis by our model provider.</p>}<div className="reddit-actions"><span>{rows.length} saved threads · {brief.followup.length} follow-ups · {clusters(rows).length} recurring problems</span>{isAdmin && <button className="btn-secondary" disabled={busy || !config.enabled || !access.ready} onClick={() => act("run")}>{busy ? "Working..." : "Run discovery now"}</button>}</div></section>
    <nav className="reddit-tabs" aria-label="Reddit workspace">{["briefing", "queue", "problems", "coverage", ...(isAdmin ? ["settings"] : [])].map((value) => <button key={value} className={tab === value ? "btn primary" : "btn-secondary"} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === "briefing" ? "Morning briefing" : value[0].toUpperCase() + value.slice(1)}</button>)}</nav>
    {message && <p role="status">{message}</p>}
    {tab === "briefing" && <section><h2>Act today and follow up</h2><p>Up to five recent opportunities with at least 70% evidence confidence, plus your watched conversations that changed or are due.</p>{!selected.length && <p>No actionable opportunities yet. Check Coverage to see whether collection ran successfully.</p>}</section>}
    {tab === "queue" && <div className="reddit-fields"><label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Stage<select value={stage} onChange={(event) => setStage(event.target.value)}><option value="">All stages</option>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label></div>}
    {(tab === "briefing" || tab === "queue") && selected.map((row) => <OpportunityCard key={`${row.id}:${row.version}:${row.checked_at}`} row={row} config={config} owner={owner} isAdmin={isAdmin} now={now} />)}
    {tab === "problems" && <><h2>Build something useful next</h2><p>Each count represents distinct discussions. These are observed needs, not estimates of market size.</p>{clusters(rows).map((cluster) => <section className="card" key={cluster.problem}><h3>{cluster.problem.replaceAll("_", " ")} · {cluster.count} discussions</h3>{cluster.threads.map((row) => <div key={row.id}><a href={row.source.permalink} target="_blank" rel="noopener noreferrer">{row.source.title}</a><p>{row.analysis?.asset}</p><blockquote>{row.analysis?.evidence[0].quote}</blockquote></div>)}</section>)}{!clusters(rows).length && <p>No repeated problem has enough independent evidence yet.</p>}</>}
    {tab === "coverage" && <><h2>Coverage and measured spend</h2><p>Searches have page limits; comments have a sample limit. A partial run does not mean the communities had no opportunities. Model caps stop new calls after the cap is reached; the last in-flight call can exceed it.</p>{runs.length ? runs.map((run) => <section className="card" key={run.id}><h3>{run.status} · {run.started_at}</h3>{run.status === "running" && !run.finished_at && <p>Run in progress. If it exceeds ten minutes, the next invocation will mark it interrupted.</p>}<pre className="reddit-report">{JSON.stringify(run.report, null, 2)}</pre></section>) : <p>No run has been recorded.</p>}<h3>Query feedback</h3>{queryPlan({ ...config, max_queries: 8 }, rows, Math.floor(now / 86400000)).map((item) => <p key={item.id}>{item.family}: {item.relevant}/{item.reviewed} reviewed threads relevant, {item.qualified} qualified or meeting. One rotating query remains exploratory.</p>)}</>}
    {tab === "settings" && isAdmin && <section className="card"><h2>Discovery settings</h2><label><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /> Enable nightly collection after approved access is configured</label><div className="reddit-fields">{(["max_queries", "max_threads", "max_watches", "cost_cap_usd", "retention_days"] as const).map((key) => <label key={key}>{key.replaceAll("_", " ")}<input type="number" value={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} /></label>)}</div>
      <h3>Communities and current rules</h3><p>Refresh the published rules, review restrictions, and record whether helpful business replies are allowed. Permission expires after seven days. A community rule cannot grant API access.</p>
      {settings.communities.map((community, index) => <fieldset key={index}><legend>Community {index + 1}</legend><div className="reddit-fields"><label>Name<input value={community.name} onChange={(event) => setSettings({ ...settings, communities: settings.communities.map((item, i) => i === index ? { ...item, name: event.target.value, rules: "", rules_checked_at: null, response_policy: "unknown" } : item) })} /></label><label>Reply policy<select value={community.response_policy} onChange={(event) => setSettings({ ...settings, communities: settings.communities.map((item, i) => i === index ? { ...item, response_policy: event.target.value as typeof community.response_policy } : item) })}><option value="unknown">Needs human review</option><option value="helpful_only">Helpful business replies permitted</option><option value="no_commercial">No commercial participation</option></select></label></div><label><input type="checkbox" checked={community.enabled} onChange={(event) => setSettings({ ...settings, communities: settings.communities.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item) })} /> Search this community</label><label className="reddit-field">Rules<textarea value={community.rules} onChange={(event) => setSettings({ ...settings, communities: settings.communities.map((item, i) => i === index ? { ...item, rules: event.target.value, rules_checked_at: null, response_policy: "unknown" } : item) })} /></label><p>Last fetched: {community.rules_checked_at ?? "Never"}</p><button className="btn-secondary" disabled={busy || !access.ready} onClick={async () => { setBusy(true); try { const result = await request({ action: "rules", name: community.name }); if (typeof result === "object" && result && "rules" in result && "checked_at" in result) setSettings({ ...settings, communities: settings.communities.map((item, i) => i === index ? { ...item, rules: String(result.rules), rules_checked_at: String(result.checked_at), response_policy: "unknown" } : item) }); } catch (error) { setMessage(error instanceof Error ? error.message : "Rules fetch failed."); } finally { setBusy(false); } }}>Fetch current rules</button><button className="btn-secondary" onClick={() => setSettings({ ...settings, communities: settings.communities.filter((_, i) => i !== index) })}>Remove</button></fieldset>)}
      {settings.communities.length < 15 && <button className="btn-secondary" onClick={() => setSettings({ ...settings, communities: [...settings.communities, { name: "", enabled: true, rules: "", rules_checked_at: null, response_policy: "unknown" }] })}>Add community</button>}
      <h3>Search families</h3>{settings.queries.map((item, index) => <fieldset key={index}><div className="reddit-fields"><label>ID<input value={item.id} onChange={(event) => setSettings({ ...settings, queries: settings.queries.map((q, i) => i === index ? { ...q, id: event.target.value } : q) })} /></label><label>Family<input value={item.family} onChange={(event) => setSettings({ ...settings, queries: settings.queries.map((q, i) => i === index ? { ...q, family: event.target.value } : q) })} /></label></div><label className="reddit-field">Search query<input value={item.query} onChange={(event) => setSettings({ ...settings, queries: settings.queries.map((q, i) => i === index ? { ...q, query: event.target.value } : q) })} /></label><label><input type="checkbox" checked={item.enabled} onChange={(event) => setSettings({ ...settings, queries: settings.queries.map((q, i) => i === index ? { ...q, enabled: event.target.checked } : q) })} /> Enabled</label><button className="btn-secondary" onClick={() => setSettings({ ...settings, queries: settings.queries.filter((_, i) => i !== index) })}>Remove</button></fieldset>)}{settings.queries.length < 25 && <button className="btn-secondary" onClick={() => setSettings({ ...settings, queries: [...settings.queries, { id: "", family: "", query: "", enabled: true }] })}>Add query</button>}<div className="reddit-actions"><button className="btn primary" disabled={busy} onClick={() => act("configure")}>Save settings</button></div>
    </section>}
  </div>;
}
