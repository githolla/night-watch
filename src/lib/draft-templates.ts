/**
 * What the greeting and subject on a seat's unsent drafts are right now, as templates ("Hi {first},",
 * "An idea for {company}"), read back from the drafts themselves. The setup page shows these, so a subject
 * applied yesterday is still there today instead of an empty box.
 */

export type TemplateRow = { body: string | null; subject: string | null; first: string; company: string };
export type CurrentTemplates = {
  /** The greeting most drafts share, or null when they differ. */
  greeting: string | null;
  /** The subject most drafts share, or null when each has its own. */
  subject: string | null;
  /** One real subject, for "each email has its own subject, for example …". */
  subjectExample: string | null;
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const swap = (text: string, value: string, token: string) => (value ? text.replace(new RegExp(`\\b${escape(value)}\\b`, "g"), token) : text);

/** The template most rows share, when at least `share` of them do. */
function common(templates: string[], share: number): string | null {
  if (!templates.length) return null;
  const counts = new Map<string, number>();
  for (const template of templates) counts.set(template, (counts.get(template) ?? 0) + 1);
  const [best, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best && count / templates.length >= share ? best : null;
}

export function currentTemplates(rows: TemplateRow[], share = 0.6): CurrentTemplates {
  const greetings = rows.map((row) => {
    const line = (row.body ?? "").split("\n")[0]?.trim() ?? "";
    return line.length <= 60 ? swap(line, row.first, "{first}") : "";
  }).filter((line) => line.includes("{first}") || /^(hi|hello|hey|dear|good)\b/i.test(line));
  const subjects = rows.filter((row) => row.subject?.trim()).map((row) => swap(swap(row.subject!.trim(), row.company, "{company}"), row.first, "{first}"));
  return {
    greeting: common(greetings, share),
    subject: common(subjects, share),
    subjectExample: rows.find((row) => row.subject?.trim())?.subject?.trim() ?? null,
  };
}
