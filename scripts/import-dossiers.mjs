import { readFileSync, writeFileSync } from 'node:fs';
const readLines = path => readFileSync(new URL(path, import.meta.url), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const briefs = readLines('../data/dossiers/account_briefs.jsonl');
const dossiers = readLines('../data/dossiers/dossiers.jsonl');
const drafts = JSON.parse(readFileSync(new URL('../data/priority-outreach.json', import.meta.url), 'utf8'));
const index = briefs.map(brief => {
  const domain = drafts.find(row => row.writerKit.accountId === brief.account_id)?.domain;
  const dossier = dossiers.find(row => row.account_id === brief.account_id && row.contact.contact_rank === 1);
  if (!domain || !dossier) throw new Error(`Missing dossier or domain: ${brief.account_id}`);
  return { domain, brief, dossier: { ...dossier, facts: dossier.facts.map(fact => ({ ...fact, published_date: fact.published_date ?? null })) } };
});
writeFileSync(new URL('../data/dossiers/index.json', import.meta.url), JSON.stringify(index, null, 2) + '\n');
