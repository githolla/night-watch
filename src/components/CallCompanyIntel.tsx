import type { CompanyIntel } from "@/lib/call-intel";
import { CompanyLogo } from "./CompanyLogo";

export function CallCompanyIntel({ company, domain, intel, facts }: { company: string; domain: string; intel: CompanyIntel; facts: string[] }) {
  return <section className="call-intel">
    <header className="call-company-identity"><CompanyLogo domain={domain} name={company} size={48} /><div><span className="overview-kick">Company intel</span><h3>{company}</h3><a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain} ↗</a></div></header>
    <p className="call-business-overview">{intel.overview || "Not available"}</p>
    {facts.length > 0 && <div className="call-facts">{facts.map(fact => <span key={fact}>{fact}</span>)}</div>}
    <dl className="call-business-basics"><div><dt>{intel.productHeading}</dt><dd>{intel.products.join(" · ") || "Not available"}</dd></div><div><dt>Who they serve</dt><dd>{intel.customers.join(" · ") || "Not available"}</dd></div></dl>
    <details className="call-more-intel"><summary>Operating details &amp; sources</summary>
      <h4>How the work operates</h4><p>{intel.operations || "Not available"}</p>
      {intel.sourceUrl && <a href={intel.sourceUrl} target="_blank" rel="noreferrer">Business profile source ↗</a>}{intel.checkedAt && <small> · Checked {intel.checkedAt}</small>}
      {intel.evidence.map(section => <div className="call-intel-evidence" key={section.title}><h4>{section.title}</h4><ul>{section.facts.map((fact, index) => <li key={`${fact.text}:${index}`}>{fact.text}{fact.date && <small> · {fact.date}</small>}{fact.url && <> <a href={fact.url} target="_blank" rel="noreferrer">Source ↗</a></>}</li>)}</ul></div>)}
      {intel.gaps.length > 0 && <><h4>To confirm</h4><ul>{intel.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></>}
    </details>
  </section>;
}
