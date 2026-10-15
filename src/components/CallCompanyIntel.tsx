import type { CompanyIntel } from "@/lib/call-intel";
import { CompanyLogo } from "./CompanyLogo";

export function CallCompanyIntel({ company, domain, intel, facts }: { company: string; domain: string; intel: CompanyIntel; facts: string[] }) {
  return <section className="call-intel">
    <header className="call-company-identity"><CompanyLogo domain={domain} name={company} size={64} /><div><span className="overview-kick">Company background &amp; intel</span><h3>{company}</h3><a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain} ↗</a></div></header>
    {facts.length > 0 && <div className="call-facts">{facts.map(fact => <span key={fact}>{fact}</span>)}</div>}
    <div className="call-business-summary"><h4>Understand the business</h4><p>{intel.overview || "Company overview not yet researched."}</p>{intel.sourceUrl && <a href={intel.sourceUrl} target="_blank" rel="noreferrer">Business profile source ↗</a>}{intel.checkedAt && <small>Research checked {intel.checkedAt}</small>}</div>
    <h4>{intel.productHeading}</h4>{intel.products.length ? <ul className="call-product-list">{intel.products.map(item => <li key={item}>{item}</li>)}</ul> : <p className="muted">Not yet recorded. Confirm the main product or service lines.</p>}
    <h4>Who they serve</h4><p>{intel.customers.join(" · ") || "Customer segments need confirming."}</p>
    <h4>How the work operates</h4><p>{intel.operations || "Operating model has not been recorded."}</p>
    {intel.evidence.map(section => <div className="call-intel-evidence" key={section.title}><h4>{section.title}</h4><ul>{section.facts.map((fact, i) => <li key={`${fact.text}:${i}`}>{fact.text}{fact.date && <small> · {fact.date}</small>}{fact.url && <> <a href={fact.url} target="_blank" rel="noreferrer">Source ↗</a></>}</li>)}</ul></div>)}
    <div className="call-angle"><span className="overview-kick">Suggested call angle</span><p>{intel.roleAngle}</p><b>Start with this question</b><p>{intel.questions[0]}</p><small>Conversation guidance, not confirmed company pain.</small></div>
    {intel.gaps.length > 0 && <details><summary>Research gaps to confirm</summary><ul>{intel.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></details>}
  </section>;
}
