"use client";
import { useId, useState } from "react";
import type { CallQuestion } from "@/lib/call-intel";

export function CallQuestionPills({ questions }: { questions: CallQuestion[] }) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const question = active === null ? null : questions[active];
  return <section className="call-question-guide" aria-label="Four questions for this call">
    <div className="call-section-heading"><h3>Four questions to guide the call</h3><span>Click one to go deeper</span></div>
    <div className="call-question-pills">{questions.slice(0, 4).map((item, index) => <button key={item.title} type="button" id={`${id}-question-${index}`} aria-expanded={active === index} aria-controls={`${id}-detail`} onClick={() => setActive(active === index ? null : index)}><span className="call-question-number">{index + 1}</span><span><small>{item.title}</small><b>{item.ask}</b></span><span aria-hidden="true">{active === index ? "−" : "+"}</span></button>)}</div>
    {question && active !== null && <div className="call-question-detail" id={`${id}-detail`} role="region" aria-labelledby={`${id}-question-${active}`}>
      <div className="call-section-heading"><span className="overview-kick">Go deeper · {question.title}</span><button type="button" className="call-question-close" onClick={() => setActive(null)}>Close ×</button></div>
      <p className="call-question-ask">{question.ask}</p>
      {question.context.length > 0 && <div className="call-question-context"><b>Research to keep in mind</b>{question.context.map((fact, index) => <p key={index}>{fact.text}{fact.url && <> <a href={fact.url} target="_blank" rel="noreferrer">Source ↗</a></>}</p>)}</div>}
      <div className="call-question-depth"><div><h4>Follow their answer</h4><ol>{question.followups.map(item => <li key={item}>{item}</li>)}</ol></div><div><h4>Listen for</h4><ul>{question.listenFor.map(item => <li key={item}>{item}</li>)}</ul><p className="muted">Possible signals, not confirmed problems.</p></div></div>
      <div className="call-goal">{question.goal}</div>
    </div>}
  </section>;
}
