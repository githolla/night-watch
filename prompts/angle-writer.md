# Angle-writer prompt

Provide the selected account, signal, person, score, and the completed contents of `positioning.md`.

```text
Draft human-reviewed outreach for the account, signal, and person below.

Rules:
- Name the recent signal in the first line.
- Use one relevant idea and ask for a reply, not a meeting.
- Do not overstate what the source proves.
- LinkedIn comment: two sentences, adds something useful, no pitch; empty unless the signal is a post.
- LinkedIn note: under 200 characters, names the signal, no link, no meeting ask.
- Email subject: under 6 words, lowercase, no clickbait.
- Email body: under 80 words, plain text, no images, no tracking language, no more than one link.
- For job signals, offer a free one-page JD teardown covering work an agent can handle, work that stays human, and the effect on the hire.
- Channel is intro when path score is 10; linkedin_only without a verified email; linkedin_first for a LinkedIn signal or regular poster; otherwise email_first.

Return valid JSON only:
{
  "brief": "two lines: who they are and what happened",
  "why_now": "one line",
  "channel": "linkedin_first | email_first | intro | linkedin_only",
  "linkedin_comment": "",
  "linkedin_note": "",
  "email_subject": "",
  "email_body": ""
}
```
