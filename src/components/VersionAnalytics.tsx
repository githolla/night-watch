import Link from 'next/link';
import type { aggregateVersions } from '@/lib/version-analytics';
type Summary = ReturnType<typeof aggregateVersions>;
const rate = (n: number, total: number) => total ? `${Math.round(n / total * 100)}%` : '—';
export function VersionAnalytics({ summary, error, source, days }: { summary: Summary; error?: string; source: string; days: string }) {
  const totals = summary.rows.reduce((sum,r)=>({sent:sum.sent+r.sent,replies:sum.replies+r.replies,opens:sum.opens+r.opens,gmail:sum.gmail+r.gmail}),{sent:0,replies:0,opens:0,gmail:0});
  return <section id="saved-versions" className="signal-analytics">
    <div className="analytics-section-head"><div><span className="eyebrow">Saved email versions</span><h2>Which versions get replies</h2></div><Link href="/activity">Contact history ↗</Link></div>
    <div className="email-tone-buttons" aria-label="Version analytics filters">
      {[['gmail','Gmail sends'],['manual','Marked sent'],['all','Both']].map(([value,label])=><Link key={value} className="btn" aria-current={source===value?'page':undefined} href={`/stats?source=${value}&days=${days}#saved-versions`}>{label}</Link>)}
      {[['30','30 days'],['90','90 days'],['all','All time']].map(([value,label])=><Link key={value} className="btn" aria-current={days===value?'page':undefined} href={`/stats?source=${source}&days=${value}#saved-versions`}>{label}</Link>)}
    </div>
    {error ? <p role="alert">Version analytics could not load: {error}</p> : <>
      <div className="metrics"><div className="metric">Conversations sent<strong>{totals.sent}</strong></div><div className="metric">Human replies<strong>{totals.replies}</strong></div><div className="metric">Reply rate<strong>{rate(totals.replies,totals.sent)}</strong></div><div className="metric">Open detected<strong>{totals.opens} / {totals.gmail}</strong></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Version</th><th>Gmail sends</th><th>Marked sent</th><th>Open detected</th><th>Replies</th><th>Reply rate</th><th>Positive / referral</th><th>OOO</th></tr></thead><tbody>
        {summary.rows.map(r=><tr key={r.label}><td>{r.label}</td><td>{r.gmail}</td><td>{r.manual}</td><td>{r.gmail ? `${r.opens} / ${r.gmail} (${rate(r.opens,r.gmail)})` : 'Not tracked'}</td><td>{r.replies}</td><td>{rate(r.replies,r.sent)}</td><td>{r.positive}</td><td>{r.ooo}</td></tr>)}
        {!summary.rows.length && <tr><td colSpan={8}>No tracked sends in this view yet. Choose a saved version, then send it or explicitly mark it sent.</td></tr>}
      </tbody></table></div>
      <p>Each contact conversation counts once. Replies after follow-ups count toward the opening version. Edited versions are separate. Out-of-office replies are excluded from reply rates. Marked-sent records are self-reported; copying never counts as sending.</p>
      <p>Open detected means the original email&apos;s image loaded, not proof it was read. Privacy proxies can load it automatically; blocked images can hide real opens. Follow-up opens are visible in history. Results are observational, not a randomized test.</p>
      {summary.untracked > 0 && <p>{summary.untracked} older or untracked Gmail conversations are excluded from version comparisons.</p>}
      {summary.recent.length > 0 && <details><summary>Recent tracked sends</summary><ul className="click-list">{summary.recent.map(r=><li key={r.id}><Link href={`/activity?person=${r.personId}`}><div><strong>{r.name} · {r.label}</strong><small>{r.subject} · {r.sentAt.slice(0,10)} · {r.source === 'gmail' ? 'Gmail' : 'Marked sent'}{r.openAt ? ' · Open detected' : ''}{r.replied ? ' · Replied' : ''}</small></div></Link></li>)}</ul></details>}
    </>}
  </section>;
}
