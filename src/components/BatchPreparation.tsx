'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
const completed = new Set<string>();
const pending = new Map<string, Promise<boolean>>();
async function prepare(domain: string) {
 if (completed.has(domain)) return false;
 const existing = pending.get(domain);
 if (existing) return existing;
 const task = fetch('/api/desk/priority-draft', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({domain}) })
  .then(response => response.ok).catch(() => false);
 pending.set(domain, task);
 try { const ok = await task; if (ok) completed.add(domain); return ok; } finally { pending.delete(domain); }
}
/** Prepare saved copy quietly while the user works; never send email. */
export function BatchPreparation({domains}:{domains:string[]}) {
 const router = useRouter();
 const key = JSON.stringify(domains);
 useEffect(() => {
  let cancelled = false;
  void (async () => {
   let changed = false;
   for (const domain of JSON.parse(key) as string[]) {
    if (cancelled) return;
    changed = await prepare(domain) || changed;
   }
   if (!cancelled && changed) router.refresh();
  })();
  return () => { cancelled = true; };
 }, [key, router]);
 return null;
}
