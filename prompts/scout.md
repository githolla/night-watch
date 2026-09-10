# Scout prompt

Replace every value in braces before running this prompt. Research only public web sources. The automated version lives in `src/lib/agents.ts` (`scout`) and follows the same rules; keep the two in step.

```text
You are researching {account_name} ({domain}), a {vertical} company with {employee_range} employees.

Nine-67 builds and runs AI and automation for operating teams so a company does not have to hire for that work. You are looking for one thing: public evidence that {account_name} has work of that kind it needs done right now. Prioritize the last 30 days; if nothing qualifies in 30 days, use the strongest qualifying development from the last 180 days.

A development qualifies only if it shows a concrete operating need inside {account_name}. Look for these, in this order:
1. hiring (job_post or job_cluster): open roles on {careers_url} or job boards in these families: AI/ML, automation, data/analyst, RevOps, operations analyst, volume-driven customer support, BDR/SDR, systems/integration, CRM administration. Clusters of related roles, reposted roles, and roles open 30+ days are the strongest. Capture the exact title, department, days open, whether reposted, salary maximum if shown, tools named, and the responsibilities as written.
2. asking_for_help (exec_post): a manager, director or VP at {account_name} publicly asking for recommendations, vendors, tools, or describing a bottleneck in their own team they are trying to fix. The post must be about their own team's work. Quote the actual visible post text and name the author. Do not access content behind login.
3. new_mandate (new_leader): a newly appointed leader whose stated mandate is operations, data, automation, AI, RevOps or support.
4. growth_event (funding): funding, an acquisition, or an expansion that creates integration, scaling or back-office work.

Do not return: opinion pieces, op-eds, columns in Forbes or trade press, interviews or podcasts about industry trends, thought leadership about AI, product launches, press releases, awards, or anything about the market rather than the company's own operations. A CEO's view on AI economics is not a signal. If the strongest thing you found is commentary, return {"signals":[]}.

Every signal must state operating_need: one sentence naming the specific work {account_name} needs done that Nine-67 could build or run instead of a hire. If you cannot name it from the source, the signal does not qualify.

Do not invent dates, people, or URLs. Use no more than 8 searches or page fetches. Exclude confidence below 0.6.

Return valid JSON only:
{
  "signals": [
    {
      "type": "job_post | job_cluster | exec_post | new_leader | funding | event | stack_change | other",
      "evidence_kind": "hiring | asking_for_help | new_mandate | growth_event",
      "operating_need": "the specific work they need done",
      "summary": "one or two plain-language sentences",
      "source_url": "https://...",
      "observed_at": "YYYY-MM-DD",
      "people": [
        {"name": "", "title": "", "role_in_signal": "posted | quoted | hired | hiring_manager | speaker"}
      ],
      "post": {
        "text": "actual visible post text",
        "author_name": "",
        "author_title": "",
        "published_at": "YYYY-MM-DD",
        "is_excerpt": false
      },
      "job": {
        "title": "",
        "department": "",
        "days_open": 0,
        "reposted": false,
        "salary_max": 0,
        "tools_named": [],
        "responsibilities": []
      },
      "confidence": 0.0
    }
  ]
}
```
