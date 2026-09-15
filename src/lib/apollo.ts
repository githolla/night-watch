import { z } from "zod";

const result = z.object({
  person: z.object({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    title: z.string().nullable(),
    linkedin_url: z.string().nullable(),
    email: z.string().nullable(),
    email_status: z.string().nullable(),
    // The person's CURRENT employer — used to tell whether they still work at the target company.
    organization: z.object({ name: z.string().nullable().optional(), primary_domain: z.string().nullable().optional(), website_url: z.string().nullable().optional() }).nullable().optional(),
  }).nullable(),
});

function hostOf(value: string | null | undefined) {
  if (!value) return null;
  try { return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return value.replace(/^www\./, "").toLowerCase(); }
}

export async function matchPerson(name: string, domain: string) {
  if (!process.env.APOLLO_API_KEY) return null;
  const [first_name, ...rest] = name.trim().split(/\s+/);
  const response = await fetch("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.APOLLO_API_KEY },
    body: JSON.stringify({ first_name, last_name: rest.join(" "), domain, reveal_personal_emails: false }),
  });
  if (!response.ok) throw new Error(`Apollo match failed: ${response.status}`);
  const person = result.parse(await response.json()).person;
  if (!person) return null;
  const currentDomain = hostOf(person.organization?.primary_domain ?? person.organization?.website_url ?? null);
  const target = domain.replace(/^www\./, "").toLowerCase();
  // Apollo knows a person's current employer. If it is a different company, they have left the target.
  const stillHere = !currentDomain || currentDomain === target;
  return { ...person, email: person.email_status === "verified" ? person.email : null, currentDomain, currentCompany: person.organization?.name ?? null, stillHere };
}
