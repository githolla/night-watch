import { CLOSED_STAGES, STAGE_LABEL, type OutreachStage } from "./outreach.ts";

/**
 * A manager's brief for one company, written from what is on file: why it
 * is a prospect, where the reach-out stands, and the next step. Rules, not
 * a model, so it is instant, free, and says only what the evidence says.
 */
export type BriefInput = {
  name: string;
  tier: string | null;
  aiSignalOnFile: string;
  roles: Array<{ title: string; family: string; postedAt: string | null }>;
  posts: Array<{ author: string; title: string; topic: string; postedAt: string | null }>;
  signals: Array<{ kind: string; summary: string; need: string | null; observedAt: string }>;
  people: Array<{ name: string; title: string; level: string; hasEmail: boolean; verified: boolean }>;
  drafts: Array<{ person: string; status: string; score: number }>;
  touches: Array<{ person: string; channel: string; sentAt: string | null; replyAt: string | null; reply: string }>;
  stage: OutreachStage;
  owner: string;
  notes: string;
  now: Date;
};

export type Brief = {
  headline: string;
  why: string[];
  standing: string[];
  next: string;
};

function days(from: string | null | undefined, now: Date) {
  if (!from) return null;
  const time = Date.parse(from);
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}
function ago(from: string | null | undefined, now: Date) {
  const value = days(from, now);
  if (value === null) return "";
  if (value === 0) return "today";
  if (value === 1) return "yesterday";
  if (value < 30) return `${value} days ago`;
  if (value < 60) return "about a month ago";
  return `${Math.round(value / 30)} months ago`;
}
function list(items: string[], max = 3) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return shown.join(", ") + (rest > 0 ? ` and ${rest} more` : "");
}

export function buildBrief(input: BriefInput): Brief {
  const why: string[] = [];
  const families = [...new Set(input.roles.map((role) => role.family))];
  if (input.roles.length) {
    const newest = input.roles.map((role) => days(role.postedAt, input.now)).filter((value): value is number => value !== null).sort((a, b) => a - b)[0];
    why.push(`Hiring ${input.roles.length} ${input.roles.length === 1 ? "role" : "roles"} Nine-67 would build a system for instead (${list(input.roles.map((role) => role.title))})${families.length > 1 ? ` across ${families.length} areas` : ""}${newest !== undefined ? `, the newest posted ${ago(input.roles.find((role) => days(role.postedAt, input.now) === newest)?.postedAt, input.now)}` : ""}. That is budget already approved for work Nine-67 does.`);
  }
  if (input.posts.length) {
    const authors = [...new Set(input.posts.map((post) => post.author))];
    why.push(`${list(authors, 2)} ${authors.length === 1 ? "has" : "have"} posted publicly about ${list([...new Set(input.posts.map((post) => post.topic).filter(Boolean))], 3) || "AI and automation"}: they are thinking about this out loud, which makes a first message easy to write.`);
  }
  // A hiring signal repeats the roles line above; keep the ones that add something.
  const needs = input.signals.filter((signal) => signal.need && !(input.roles.length && signal.kind === "hiring")).slice(0, 2);
  for (const signal of needs) why.push(`${signal.kind.replace(/_/g, " ")} (${ago(signal.observedAt, input.now)}): ${signal.need}`);
  if (input.aiSignalOnFile) why.push(`The target file already noted: ${input.aiSignalOnFile}.`);
  if (input.tier === "A1") why.push("Tier A1: first wave of the cut, so this company was already judged a fit on revenue, AI signal and ownership.");
  if (!why.length) why.push("Nothing found yet beyond the file's own reason for listing them. The scan keeps looking; until it finds a role, a post or a request for help, there is no reason to write.");

  const owners = input.people.filter((person) => person.level === "owner");
  const reachable = input.people.filter((person) => person.hasEmail);
  const standing: string[] = [];
  const sent = input.touches.filter((touch) => touch.sentAt).sort((a, b) => Date.parse(b.sentAt!) - Date.parse(a.sentAt!));
  const replied = input.touches.filter((touch) => touch.replyAt).sort((a, b) => Date.parse(b.replyAt!) - Date.parse(a.replyAt!));
  if (sent.length) standing.push(`Last reach-out: ${sent[0].channel.replace(/_/g, " ")} to ${sent[0].person}, ${ago(sent[0].sentAt, input.now)}${sent.length > 1 ? ` (${sent.length} touches in total)` : ""}.`);
  else standing.push("No one has been contacted yet.");
  if (replied.length) standing.push(`Last reply: ${replied[0].person}, ${replied[0].reply}, ${ago(replied[0].replyAt, input.now)}.`);
  else if (sent.length) standing.push("No reply yet.");
  standing.push(`Stage: ${STAGE_LABEL[input.stage]}${input.owner ? ` · owned by ${input.owner}` : " · nobody owns it yet"}.`);
  standing.push(`${input.people.length ? `${input.people.length} people on file, ${owners.length} decision ${owners.length === 1 ? "owner" : "owners"}, ${reachable.length} with an address (${input.people.filter((person) => person.verified).length} verified)` : "No people on file yet"}.`);
  if (input.notes.trim()) standing.push(`Notes: ${input.notes.trim()}`);

  const openDrafts = input.drafts.filter((draft) => ["new", "approved", "edited", "snoozed"].includes(draft.status)).sort((a, b) => b.score - a.score);
  let next: string;
  if (CLOSED_STAGES.has(input.stage)) next = input.stage === "won" ? "Won. Nothing to send; keep the relationship warm." : input.stage === "lost" ? "Closed as no fit. Reopen only if a new signal appears." : "On hold by decision. The scan keeps watching; revisit when something changes.";
  else if (replied.length && input.stage !== "meeting") next = `${replied[0].person} replied (${replied[0].reply}); answer today and propose a time.`;
  else if (input.stage === "meeting") next = "Meeting set. Prepare the roles and posts below as the agenda.";
  else if (sent.length) {
    const since = days(sent[0].sentAt, input.now) ?? 0;
    next = since >= 5 ? `No reply in ${since} days; send the follow-up to ${sent[0].person}, or try the next person on file.` : `Sent ${ago(sent[0].sentAt, input.now)}; give it until day 5 before following up.`;
  } else if (openDrafts.length) next = `Send the draft to ${openDrafts[0].person} (score ${openDrafts[0].score}); it is written and waiting on the desk.`;
  else if (owners.length && why.length && !why[0].startsWith("Nothing found")) next = `Write to ${owners[0].name} (${owners[0].title}) about the ${input.roles.length ? "open roles" : "work they posted about"}; no draft exists yet, the next research pass writes one.`;
  else if (input.people.length) next = `No decision owner on file yet; ${input.people[0].name} (${input.people[0].title}) is the closest. Find the COO, CIO or CTO before writing.`;
  else next = "Nobody on file yet. The next scan looks for people; nothing to send until then.";

  const headline = openDrafts.length ? `Ready to send: ${openDrafts.length} ${openDrafts.length === 1 ? "draft" : "drafts"} waiting` : input.roles.length || input.posts.length || needs.length ? `Good prospect: ${[input.roles.length ? `${input.roles.length} target ${input.roles.length === 1 ? "role" : "roles"}` : null, input.posts.length ? `${input.posts.length} AI ${input.posts.length === 1 ? "post" : "posts"}` : null, needs.length ? `${needs.length} ${needs.length === 1 ? "signal" : "signals"}` : null].filter(Boolean).join(", ")}` : "Not a prospect yet: nothing found";
  return { headline, why, standing, next };
}
