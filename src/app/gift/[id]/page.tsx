import { notFound } from 'next/navigation';
import { giftAsset } from '@/lib/research-recommendation';
import { giftReference } from '@/lib/gift-tracking';
import { GiftViewSignal } from '@/components/GiftViewSignal';
export const dynamic='force-dynamic';
export const metadata={title:'Your working brief | Nine-67',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function GiftPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{t?:string}>}) {
 const {id}=await params;const gift=giftAsset(id);if(!gift)notFound();
 const {t}=await searchParams;const ref=t?giftReference(t):null;
 return <main className="gift-page">
  {ref?.assetId===id&&t&&<GiftViewSignal token={t}/>}
  <header><a href="https://www.nine-67.com">Nine-67<span>AI built around the work.</span></a><span>Prepared {gift.preparedAt}</span></header>
  <div className="gift-kicker">A working brief for {gift.company}</div>
  <h1>{gift.title}</h1>
  <p className="gift-recipient">Prepared for {gift.contactName} · {gift.contactTitle}</p>
  <section><h2>Why this starting point</h2><p>{gift.source.fact}</p><a href={gift.source.sourceUrl} target="_blank" rel="noreferrer">Source: {new URL(gift.source.sourceUrl).hostname.replace(/^www\./,'')} ↗</a>{gift.source.date&&<small> · Published {gift.source.date}</small>}</section>
  <section><h2>Three checks to test</h2><p>Start with one sample of {gift.inputs}. Use approved records and keep a person responsible for decisions.</p><ol>{gift.checks.map((check,i)=><li key={i}>{check}</li>)}</ol></section>
  <section className="gift-measures"><h2>How to decide whether it helps</h2><p>Record a baseline using the current process, then compare the same task with the first version.</p><ul>{gift.measures.map(m=><li key={m}>{m}</li>)}</ul><p>Keep the first test small. Stop or revise it if the team cannot verify its output or it creates more work.</p></section>
  <aside>{gift.scope}</aside>
  <footer><strong>Built with the people who will use it.</strong><p>Nine-67 works with leaders to choose a task, builds a first version, tests it with users, and stays through training and deployment.</p><a href="https://www.nine-67.com">nine-67.com ↗</a><small>Shared links can record a first page-view signal. That signal does not confirm who read this page.</small></footer>
 </main>;
}
