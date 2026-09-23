// Deterministic gate for Nine-67 outbound drafts.
// Runs before the Critic. Any error = rewrite without spending an LLM call on critique.
// Usage: import { lintEmail } from "./lint"; or `npx tsx src/lint.ts data/few_shot_examples.jsonl`

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(readFileSync(resolve(here, "../data/style_rules.json"), "utf8"));

export type Touch = 1 | 2 | 3 | 4;
export interface Draft {
  touch: Touch;
  subject: string | null;
  body: string; // body only, no signature
  claims?: { text: string; fact_id: string | null; proof_line_index: number | null }[];
}
export interface LintIssue { rule: string; severity: "error" | "warn"; detail: string }
export interface LintResult { pass: boolean; issues: LintIssue[]; stats: Record<string, number> }

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const sentences = (t: string) =>
  t.replace(/\n+/g, " ").split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter((s) => words(s).length > 0);

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}
function fkGrade(text: string): number {
  const ws = words(text), ss = sentences(text);
  if (!ws.length || !ss.length) return 0;
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  return 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59;
}

export function lintEmail(d: Draft): LintResult {
  const issues: LintIssue[] = [];
  const err = (rule: string, detail: string) => issues.push({ rule, severity: "error", detail });
  const warn = (rule: string, detail: string) => issues.push({ rule, severity: "warn", detail });
  const body = d.body.trim();
  const lower = body.toLowerCase();
  const wc = words(body).length;
  // Prose without the greeting ("Dana," line or "Dana, " prefix) for sentence and grade stats
  const prose = body.replace(/^(hi |hey |hello )?[A-Z][a-z]+,\s*/i, "");
  const len = rules.length[`touch_${d.touch}_words`];

  // Length
  if (wc < len.min || wc > len.max) err("word_count", `${wc} words, need ${len.min}-${len.max}`);
  if (len.min_sentences && sentences(prose).length < len.min_sentences)
    err("min_sentences", `${sentences(prose).length} sentences, need ${len.min_sentences}+`);
  for (const s of sentences(prose))
    if (words(s).length > rules.length.max_sentence_words) warn("long_sentence", `"${s.slice(0, 60)}..." (${words(s).length} words)`);
  const grade = fkGrade(prose);
  if (grade > rules.length.max_reading_grade) warn("reading_grade", `grade ${grade.toFixed(1)} > ${rules.length.max_reading_grade}`);

  // Subject
  if (d.touch === 1) {
    if (!d.subject) err("subject_missing", "touch 1 needs a subject");
    else {
      const sw = words(d.subject).length;
      if (sw < rules.length.subject_words.min || sw > rules.length.subject_words.max) err("subject_length", `${sw} words`);
      if (/^(re|fwd?):/i.test(d.subject)) err("fake_reply_subject", d.subject);
      if (/[?!]/.test(d.subject)) err("subject_punctuation", "no ? or ! in subject");
    }
  } else if (d.subject) err("subject_on_followup", "touches 2-4 reply in thread; subject must be null");

  // Format
  if (/[—–]/.test(body) || /[—–]/.test(d.subject ?? "")) err("em_dash", "em/en dash found");
  if (body.includes("!")) err("exclamation", "no exclamation marks");
  if (/<[a-z][\s\S]*>/i.test(body)) err("html", "plain text only");
  const links = (body.match(/https?:\/\/\S+|www\.\S+/gi) || []).length;
  const allowed = rules.format.links_allowed[String(d.touch)];
  if (links > allowed) err("links", `${links} links, touch ${d.touch} allows ${allowed}`);
  const qs = (body.match(/\?/g) || []).length;
  if (qs !== 1) err("question_count", `${qs} question marks; need exactly 1 (the CTA)`);
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines[lines.length - 1]?.endsWith("?")) err("cta_last_line", "last line must be the CTA question");

  // Opener
  const firstContent = lines.find((l) => !/^(hi|hey|hello)?\s*[A-Z][a-z]+,\s*$/.test(l)) ?? "";
  const opener = firstContent.replace(/^(hi |hey |hello )?[A-Z][a-z]+,\s*/i, "");
  for (const p of rules.opener_rules.must_not_start_with)
    if (opener.toLowerCase().startsWith(p.toLowerCase())) err("weak_opener", `opens with "${p}"`);

  // Banned phrases and CTAs
  for (const p of rules.banned_phrases) if (lower.includes(p.toLowerCase())) err("banned_phrase", p);
  for (const p of rules.cta_library.banned_ctas) if (lower.includes(p.toLowerCase())) err("banned_cta", p);

  // Claims
  if (d.claims) for (const c of d.claims)
    if (!c.fact_id && c.proof_line_index == null) err("unsourced_claim", c.text);

  // "I" density: emails that are about the sender underperform
  const iCount = words(body).filter((w) => /^(i|i'm|i've|i'd|me|my|we|we're|our|us)$/i.test(w.replace(/[^a-z']/gi, ""))).length;
  const youCount = words(body).filter((w) => /^(you|your|you're|yours)$/i.test(w.replace(/[^a-z']/gi, ""))).length;
  if (iCount > youCount + 2) warn("self_focus", `${iCount} I/we vs ${youCount} you`);

  return {
    pass: !issues.some((i) => i.severity === "error"),
    issues,
    stats: { words: wc, sentences: sentences(prose).length, grade: Number(grade.toFixed(1)), links, questions: qs },
  };
}

// CLI: lint every `output` in a JSONL file (few-shot, contrastive `good`, eval expectations)
if (process.argv[1] && process.argv[1].endsWith("lint.ts") && process.argv[2]) {
  const rows = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let fails = 0;
  for (const r of rows) {
    const drafts: Draft[] = r.output ? [r.output] : r.good ? [r.good] : r.touches ?? [];
    for (const d of drafts) {
      const res = lintEmail(d);
      const tag = res.pass ? "PASS" : "FAIL";
      if (!res.pass) fails++;
      console.log(`${tag} ${r.id} t${d.touch} ${JSON.stringify(res.stats)}`);
      for (const i of res.issues) console.log(`   ${i.severity}: ${i.rule} ${i.detail}`);
    }
  }
  process.exitCode = fails ? 1 : 0;
}
