# Scout prompt

Replace every value in braces before running this prompt. Research only public web sources.

```text
You are researching {account_name} ({domain}), a {vertical} company with {employee_range} employees.

Find anything that changed in the last 48 hours. Check, in order:
1. News and press: search "{account_name}" news from the past 2 days.
2. Careers page: {careers_url}. List open roles and identify newly posted or reposted roles.
3. Public LinkedIn company pages and public executive posts: search "{account_name}" site:linkedin.com from the past week. Do not access content behind login.
4. Funding, acquisition, leadership, and new-market announcements.
5. Conference or event listings naming the company or an executive.

Allowed types: job_post, job_cluster, exec_post, new_leader, funding, event, stack_change, other.

Return only qualifying signals. Return {"signals":[]} if none qualify. Name the person most responsible when a source names or strongly implies one. Do not invent dates, people, or URLs. Use no more than 8 searches or page fetches. Exclude confidence below 0.6.

Return valid JSON only:
{
  "signals": [
    {
      "type": "job_post | job_cluster | exec_post | new_leader | funding | event | stack_change | other",
      "summary": "one or two plain-language sentences",
      "source_url": "https://...",
      "observed_at": "YYYY-MM-DD",
      "people": [
        {"name": "", "title": "", "role_in_signal": "posted | quoted | hired | hiring_manager | speaker"}
      ],
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
