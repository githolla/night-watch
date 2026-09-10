import Image from "next/image";
import Link from "next/link";
import { SystemClock } from "@/components/SystemClock";

type CardSummary={id:string;score:number;status:string;channel:string;why_now:string;assigned_to:string;accounts:{name:string};people:{full_name:string;title:string};signals:{type?:string;summary:string;source_url:string}};
export type DashboardData={metrics:{newSignals:number;surfacedCards:number;highPriority:number;positiveReplies:number};run:{status:string;finishedAt:string;accounts:number;signals:number;cards:number;cost:number;duration:string};sources:Array<{name:string;count:number;share:number;detail:string;filter:string}>;pipeline:Array<{name:string;count:number;note:string;href:string}>;recentSignals:Array<{id:string;type:string;account:string;summary:string;age:string;source:string;sourceUrl:string;cardId:string|null;isNew:boolean}>;accounts:Array<{name:string;signalCount:number;topSignal:string;score:number;owner:string}>;activity:Array<{time:string;label:string;detail:string}>};

export function Dashboard({data,cards}:{data:DashboardData;cards:CardSummary[]}){
  const date=new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric"}).format(new Date());
  return <main className="overview">
    <section className="precision-hero">
      <Image className="nightscape-image" src="/night-watch-los-angeles.png" alt="Los Angeles glowing at night beneath a charcoal sky" fill priority sizes="100vw"/>
      <div className="nightscape-wash"/>
      <aside className="hero-index">
        <span className="micro-label">INTELLIGENCE INDEX</span>
        <nav aria-label="Dashboard sections">
          <a href="#priority">PEOPLE</a>
          <a href="#signals">SIGNALS</a>
          <a href="#sources">SOURCES</a>
          <a href="#accounts">ACCOUNTS</a>
          <a href="#activity">ACTIVITY</a>
        </nav>
        <span className="index-rule"/>
      </aside>
      <div className="hero-message">
        <div className="hero-sequence"><span>DAILY BRIEF / {date.toUpperCase()}</span><span>RUN 09—67</span></div>
        <h1>Morning intelligence<br/>is ready.</h1>
        <p>Night Watch reviewed {data.run.accounts} accounts while your team was offline. The strongest reasons to reach out are organized below for human judgment.</p>
        <div className="hero-actions"><Link className="hero-primary" href="/desk">Open the morning desk <span>→</span></Link><a className="hero-secondary" href="#signals">Review new signals</a></div>
        <div className="hero-footnotes"><span>{data.metrics.highPriority} PRIORITY PEOPLE</span><span>{data.metrics.newSignals} MARKET CHANGES</span><span>{data.metrics.positiveReplies} REPLIES WAITING</span></div>
      </div>
      <aside className="watch-panel">
        <div className="watch-panel-head"><span>WATCH STATUS</span><span>NW—01</span></div>
        <SystemClock/>
        <div className="watch-measures"><div><span>LAST SCAN</span><strong>{data.run.finishedAt}</strong></div><div><span>DURATION</span><strong>{data.run.duration}</strong></div><div><span>RUN COST</span><strong>${data.run.cost.toFixed(2)}</strong></div></div>
        <p>Quiet systems. Clear reasons.<br/>Human decisions before outreach.</p>
      </aside>
      <div className="system-rail"><span><i/> SYSTEM ONLINE</span><span>{data.run.status.toUpperCase()} / SECURE WORKSPACE</span><span>NINE—67 · NIGHT WATCH</span></div>
    </section>

    <section className="overview-demo"><span>SHAPE YOUR WORKSPACE</span><p>Choose the Night Watch features that match your role and today’s objective.</p><Link href="/settings">Open feature guide →</Link></section>

    <section className="overview-metrics" aria-label="Morning overview">
      <Link href="/?view=signals" className="overview-metric"><span>01 / New signals</span><strong>{data.metrics.newSignals}</strong><small>found in the last 48 hours</small><b>Explore →</b></Link>
      <Link href="/desk" className="overview-metric"><span>02 / Surfaced cards</span><strong>{data.metrics.surfacedCards}</strong><small>ranked for this morning</small><b>Review →</b></Link>
      <Link href="/desk?priority=high" className="overview-metric"><span>03 / High priority</span><strong>{data.metrics.highPriority}</strong><small>score of 75 or above</small><b>Decide →</b></Link>
      <Link href="/desk?status=positive" className="overview-metric"><span>04 / Positive replies</span><strong>{data.metrics.positiveReplies}</strong><small>need a human response</small><b>Respond →</b></Link>
    </section>

    <section className="overview-grid" id="priority"><div className="overview-main"><div className="section-heading"><div><div className="eyebrow">01 / Decision queue</div><h2>People worth your attention</h2><p>Ranked by signal strength, relationship path, and timing.</p></div><Link href="/desk">Open complete desk →</Link></div><div className="priority-list">{cards.slice(0,4).map((card,index)=><Link key={card.id} href={`/desk?card=${card.id}`} className="priority-row"><span className="rank">0{index+1}</span><div className="priority-person"><strong>{card.people.full_name}</strong><small>{card.people.title} · {card.accounts.name}</small></div><p>{card.why_now}</p><span className="channel-label">{card.channel.replaceAll("_"," ")}</span><span className="priority-score">{card.score}</span></Link>)}</div></div><aside className="overview-side"><div className="section-heading"><div><div className="eyebrow">Flow index</div><h2>Signal to action</h2></div></div><div className="pipeline-list">{data.pipeline.map((stage,index)=><Link href={stage.href} className="pipeline-stage" key={stage.name}><span>0{index+1}</span><div><strong>{stage.name}</strong><small>{stage.note}</small></div><b>{stage.count}</b></Link>)}</div></aside></section>

    <section className="overview-grid lower" id="signals"><div className="overview-main"><div className="section-heading"><div><div className="eyebrow">02 / Live intake</div><h2>What changed overnight</h2><p>Source-backed changes that may create a reason to reach out.</p></div><Link href="/?view=signals">See every signal →</Link></div><div className="signal-feed">{data.recentSignals.map(signal=><article className="signal-row" key={signal.id}><div>{signal.isNew&&<span className="new-label">New</span>}<span className="signal-type">{signal.type}</span><small>{signal.age}</small></div><div><strong>{signal.account}</strong><p>{signal.summary}</p></div><div className="signal-links"><a href={signal.sourceUrl} target="_blank" rel="noreferrer">View source ↗</a>{signal.cardId&&<Link href={`/desk?card=${signal.cardId}`}>Open person →</Link>}</div></article>)}</div></div><aside className="overview-side" id="sources"><div className="section-heading"><div><div className="eyebrow">Source register</div><h2>Evidence mix</h2></div></div><div className="source-list">{data.sources.map(source=><Link href={`/desk?source=${source.filter}`} key={source.name} className="source-row"><div><strong>{source.name}</strong><small>{source.detail}</small></div><b>{source.count}</b><div className="source-track"><span style={{width:`${source.share}%`}}/></div></Link>)}</div></aside></section>

    <section className="overview-grid lower" id="accounts"><div className="overview-main"><div className="section-heading"><div><div className="eyebrow">03 / Account watch</div><h2>Companies in motion</h2><p>Where multiple signals are beginning to form a pattern.</p></div></div><table className="account-table"><thead><tr><th>Account</th><th>Signals</th><th>Strongest signal</th><th>Top score</th><th>Owner</th></tr></thead><tbody>{data.accounts.map(account=><tr key={account.name}><td><Link href="/desk">{account.name}</Link></td><td>{account.signalCount}</td><td>{account.topSignal}</td><td>{account.score}</td><td>{account.owner}</td></tr>)}</tbody></table></div><aside className="overview-side" id="activity"><div className="section-heading"><div><div className="eyebrow">Decision log</div><h2>Human activity</h2></div></div><div className="activity-list">{data.activity.map(item=><div className="activity-row" key={`${item.time}-${item.detail}`}><time>{item.time}</time><div><strong>{item.label}</strong><small>{item.detail}</small></div></div>)}</div></aside></section>
  </main>
}
