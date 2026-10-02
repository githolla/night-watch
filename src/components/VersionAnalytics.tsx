import Link from 'next/link';
import type { aggregateVersions, listOutcomeReport, OutcomeLine } from '@/lib/version-analytics';
type Summary = ReturnType<typeof aggregateVersions>;
type Grouping = 'version' | 'sender' | 'fit';
const rate = (n: number, total: number) => total ? `${Math.round(n / total * 100)}%` : '—';
const seat = (owner: string) => owner === 'josh' ? 'Josh' : owner === 'jenna' ? 'Suuchi' : owner;
export function VersionAnalytics({ summary, error, source, days, group = 'version' }: { summary: Summary; error?: string; source: string; days: string; group?: Grouping }) {
  const totals = summary.rows.reduce((sum,r)=>({sent:sum.sent+r.sent,replies:sum.replies+r.replies,opens:sum.opens+r.opens,gmail:sum.gmail+r.gmail}),{sent:0,replies:0,opens:0,gmail:0});
  const grouped = group !== 'version';
  return <section id="saved-versions" className="signal-analytics">
    <div className="analytics-section-head"><div><span className="eyebrow">Saved outreach versions</span><h2>Which versions get replies</h2></div><Link href="/activity">Contact history ↗</Link></div>
    <div className="email-tone-buttons" aria-label="Version analytics filters">
      {[['gmail','Gmail sends'],['manual','Marked sent'],['all','Both']].map(([value,label])=><Link key={value} className="btn" aria-current={source===value?'page':undefined} href={`/stats?source=${value}&days=${days}&group=${group}#saved-versions`}>{label}</Link>)}
      {[['30','30 days'],['90','90 days'],['all','All time']].map(([value,label])=><Link key={value} className="btn" aria-current={days===value?'page':undefined} href={`/stats?source=${source}&days=${value}&group=${group}#saved-versions`}>{label}</Link>)}
      {[['version','By version'],['sender','By sender'],['fit','By AI fit']].map(([value,label])=><Link key={value} className="btn" aria-current={group===value?'page':undefined} href={`/stats?source=${source}&days=${days}&group=${value}#saved-versions`}>{label}</Link>)}
    </div>
    {error ? <p role="alert">Version analytics could not load: {error}</p> : <>
      <div className="metrics"><div className="metric">Conversations sent<strong>{totals.sent}</strong></div><div className="metric">Human replies<strong>{totals.replies}</strong></div><div className="metric">Reply rate<strong>{rate(totals.replies,totals.sent)}</strong></div><div className="metric">Open detected<strong>{totals.opens} / {totals.gmail}</strong></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Version</th>{grouped && <th>{group === 'sender' ? 'Sender' : 'AI fit'}</th>}<th>Gmail sends</th><th>Marked sent</th><th>Open detected</th><th>Gift views</th><th>Replies</th><th>Reply rate</th><th>Positive / referral</th><th>OOO</th></tr></thead><tbody>
        {summary.rows.map(r=><tr key={`${r.label}:${r.group ?? ''}`}><td>{r.label}</td>{grouped && <td>{group === 'sender' ? seat(r.group ?? '') : r.group}</td>}<td>{r.gmail}</td><td>{r.manual}</td><td>{r.gmail ? `${r.opens} / ${r.gmail} (${rate(r.opens,r.gmail)})` : 'Not tracked'}</td><td>{r.giftViews}</td><td>{r.replies}</td><td>{rate(r.replies,r.sent)}</td><td>{r.positive}</td><td>{r.ooo}</td></tr>)}
        {!summary.rows.length && <tr><td colSpan={grouped ? 10 : 9}>No tracked sends in this view yet. Choose a saved version, then send it or explicitly mark it sent.</td></tr>}
      </tbody></table></div>
      <p>Each contact conversation counts once per channel. LinkedIn versions appear under Marked sent and are separate from email. Replies after follow-ups count toward the opening version. Edited versions are separate. Out-of-office replies are excluded from reply rates. Marked-sent records are self-reported; copying never counts as sending.</p>
      {group === 'fit' && <p>AI fit is the score of the company&apos;s nightly list row; companies from the curated lists have no fit score.</p>}
      <p>New first emails have no tracking pixels or Gift links. Judge those versions by replies; historical open counts do not measure their performance.</p>
      <p>Open detected means the original email&apos;s image loaded, not proof it was read. Privacy proxies can load it automatically; blocked images can hide real opens. Follow-up opens are visible in history. Results are observational, not a randomized test.</p>
      <p>Gift views count a first visible-page signal from a tracked Gmail link. Scanners and forwarded links can trigger it; it is a reason to review a personal follow-up, not proof of interest. Tests and untracked preview links are excluded.</p>
      {summary.untracked > 0 && <p>{summary.untracked} older or untracked Gmail conversations are excluded from version comparisons.</p>}
      {summary.recent.length > 0 && <details><summary>Recent tracked sends</summary><ul className="click-list">{summary.recent.map(r=><li key={r.id}><Link href={`/activity?person=${r.personId}`}><div><strong>{r.name} · {r.label}</strong><small>{r.subject} · {r.sentAt.slice(0,10)} · {r.source === 'gmail' ? 'Gmail' : 'Marked sent'}{r.openAt ? ' · Open detected' : ''}{r.giftViewAt ? ' · Gift viewed: consider a personal follow-up' : ''}{r.replied ? ' · Replied' : ''}</small></div></Link></li>)}</ul></details>}
    </>}
  </section>;
}

type ListReport = ReturnType<typeof listOutcomeReport>;
function OutcomeRows({ rows, weights }: { rows: Array<OutcomeLine & { weight?: number | null }>; weights?: boolean }) {
  return <>{rows.map(row => <tr key={row.label}><td>{row.label}</td><td>{row.sends}</td><td>{row.replies} ({rate(row.replies, row.sends)})</td><td>{row.positive}</td><td>{row.meetings}</td>{weights && <td>{row.weight == null ? 'not learned' :`×${row.weight.toFixed(2)}`}</td>}<td>{row.tooSmall ? 'Too few replies to read' : ''}</td></tr>)}</>;
}

/** Outcomes for companies the nightly list picked, by AI-fit band and by sector. Measurement only. */
export function ListOutcomes({ report, error, days, minFit, suggested }: { report: ListReport | null; error?: string; days: string; minFit: number; suggested: number | null }) {
  return <section id="list-outcomes" className="signal-analytics">
    <div className="analytics-section-head"><div><span className="eyebrow">Nightly lists</span><h2>List outcomes</h2></div><span>{days === 'all' ? 'ALL TIME' : `LAST ${days} DAYS`}</span></div>
    {error || !report ? <p role="alert">List outcomes could not load{error ? `: ${error}` : '.'}</p> : <>
      <div className="metrics"><div className="metric">Companies emailed<strong>{report.total.sends}</strong></div><div className="metric">Replies<strong>{report.total.replies}</strong></div><div className="metric">Positive<strong>{report.total.positive}</strong></div><div className="metric">Meetings<strong>{report.total.meetings}</strong></div></div>
      <h3>By AI fit</h3>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Fit band</th><th>Sends</th><th>Replies</th><th>Positive</th><th>Meetings</th><th /></tr></thead><tbody>
        <OutcomeRows rows={report.bands} />
      </tbody></table></div>
      <p>The list keeps companies scoring at least {minFit} (NIGHTLY_LIST_MIN_FIT). {suggested === null ? 'There are not enough replies yet to suggest a different minimum.' : suggested === minFit ? `The replies so far support keeping ${minFit}.` : `Suggested minimum from replies so far: ${suggested}. This is a suggestion only; change NIGHTLY_LIST_MIN_FIT yourself if you agree.`}</p>
      <h3>By sector</h3>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Sector</th><th>Sends</th><th>Replies</th><th>Positive</th><th>Meetings</th><th>Learned weight</th><th /></tr></thead><tbody>
        <OutcomeRows rows={report.sectors} weights />
        {!report.sectors.length && <tr><td colSpan={7}>No emails to listed companies in this view yet.</td></tr>}
      </tbody></table></div>
      <p>Each company counts once, from its first email; follow-ups add nothing, and a company later dismissed still counts. Positive means a positive or referral reply, or a meeting, qualified or opportunity stage. The learned weight (0.7 to 1.5) is computed over all time; &quot;not learned&quot; means there are fewer than 5 positives overall, so the sector counts as 1. Groups with fewer than 10 replies are too small to read anything into.</p>
    </>}
  </section>;
}
