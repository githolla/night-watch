import type { PersonLevel, SignalType } from "./types";
const bases: Record<SignalType, number> = {
  job_cluster: 40,
  exec_post: 35,
  new_leader: 30,
  job_post: 25,
  funding: 20,
  event: 20,
  stack_change: 15,
  other: 10,
};
export function strength(type: SignalType, job?: { days_open?: number; reposted?: boolean; salary_max?: number }) {
  let value = bases[type];
  if (type === "job_post") {
    if ((job?.days_open ?? 0) >= 30) value += 5;
    if (job?.reposted) value += 5;
    if ((job?.salary_max ?? 0) >= 120000) value += 5;
  }
  return Math.min(40, value);
}
export function recency(observedAt: string, now = new Date()) {
  const days = Math.max(0, Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(observedAt)) / 864e5));
  return Math.max(0, 20 - Math.max(0, days - 1) * 3);
}
export function score(input: {
  type: SignalType;
  level: PersonLevel;
  observedAt: string;
  pathScore: number;
  job?: { days_open?: number; reposted?: boolean; salary_max?: number };
  item?: { days_open?: number; reposted?: boolean; salary_max?: number };
}) {
  const breakdown = {
    strength: strength(input.type, input.job ?? input.item),
    person_fit: { owner: 30, influencer: 20, adjacent: 10, unknown: 0 }[input.level],
    recency: recency(input.observedAt),
    path: Math.min(10, Math.max(0, input.pathScore)),
  };
  return { score: Object.values(breakdown).reduce((a, b) => a + b, 0), breakdown };
}
