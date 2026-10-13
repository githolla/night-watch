import { z } from "zod";
import { runSearchAgent } from "./agents.ts";
import { researchBudget, withBudget } from "./anthropic-cost.ts";
import { researchModel } from "./models.ts";
import type { FoundEvidence } from "./address-finder.ts";

const evidence = z.object({ address: z.string().email(), sourceUrl: z.string().url(), sourceDate: z.string().nullable() });

/** Broader research produces a citation to re-fetch, never permission to send. */
export async function researchAddress(input: { name: string; company: string; domain: string; rejected: string[] }, signal?: AbortSignal): Promise<{ evidence: FoundEvidence | null; sourceDate: string | null; costUsd: number }> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return { evidence: null, sourceDate: null, costUsd: 0 };
  let costUsd = 0;
  const result = await runSearchAgent(`Find the current personal business email for ${JSON.stringify(input)}.
Search the company's individual leadership biographies, company-issued releases, industry association directories, and public business correspondence, including PDFs. A website and company email may use different domains, but an alternate domain must be explicitly published on the company's own site. Never return a rejected address, a shared inbox, a guessed pattern, or a data-broker listing. Confirm the named person's identity and current affiliation. Return JSON {"address":"...","sourceUrl":"...","sourceDate":"YYYY-MM-DD"} only if the exact address and named person are published together; otherwise return null. Use the document's actual publication date, or null if unknown.`, { model: researchModel(), maxSearches: 3, maxTokens: 1500, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) }, withBudget((cost) => { costUsd += cost; }, researchBudget(3, 0.25)));
  const parsed = evidence.safeParse(result);
  if (!parsed.success || input.rejected.includes(parsed.data.address.toLowerCase())) return { evidence: null, sourceDate: null, costUsd };
  return { evidence: { kind: "published", address: parsed.data.address.toLowerCase(), sourceUrl: parsed.data.sourceUrl }, sourceDate: parsed.data.sourceDate, costUsd };
}
