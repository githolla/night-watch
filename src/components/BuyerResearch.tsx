import { accountBrief, primaryFact, isBlank, dateLabel, sourceDomain, capitalize } from "@/lib/dossier-data";

export function BuyerResearch({ domain }: { domain: string }) {
  const brief = accountBrief(domain);
  const fact = primaryFact(domain);
  if (!brief) return null;
  const source = sourceDomain(fact?.source_url);
  const published = dateLabel(fact?.published_date);
  const researched = dateLabel(fact?.retrieved_at);
  return <>
    {!isBlank(fact?.statement) && <p className="deskwork-opening-lead">{fact?.statement}</p>}
    {!isBlank(brief.pain_hypothesis.problem) && <p className="deskwork-opening-need"><b>Potential relevance:</b> {brief.pain_hypothesis.problem}</p>}
    <div className="research-fit-chips" aria-label="Fit assessment">
      {!isBlank(brief.send_wave) && <span className="chip">Wave {brief.send_wave}</span>}
      {!isBlank(brief.router_output.value_driver) && <span className="chip">{capitalize(brief.router_output.value_driver)}</span>}
    </div>
    {source && <a className="focus-link" href={fact!.source_url} target="_blank" rel="noreferrer">{source} ↗</a>}
    <p className="deskwork-opening-need">Published {published ?? "date not confirmed"}{researched ? ` · researched ${researched}` : ""}</p>
  </>;
}
