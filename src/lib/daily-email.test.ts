import assert from "node:assert/strict";
import test from "node:test";
import { eveningEmail, morningEmail, type EveningData, type MorningData } from "./daily-email.ts";
import { chartDays, insightsFrom, nextSendDay, previousSendDay } from "./daily-email-stats.ts";
import type { SentTouch } from "./sent-stats.ts";

const base = "https://app.test";
const tile = (label: string, value: number) => ({ label, value, note: "", tone: "plain" as const, href: `${base}/x` });
const morning = (extra: Partial<MorningData> = {}): MorningData => ({
  first: "Suuchi", dateLabel: "Tuesday, October 13", appHref: `${base}/?owner=suuchi`,
  send: { state: "on", going: 30, window: "9:00am to 11:30am", dayLabel: "today", queue: [{ name: "Ann Adams", company: "Alpha Pest", domain: "alpha.com", note: "Quick idea", tone: "plain", href: `${base}/outreach?list=suuchi&card=1`, time: "9:00am" }], href: `${base}/auto-send?owner=suuchi` },
  list: { dateLabel: "Tuesday, October 13", companies: [{ company: "Bravo <Roofing>", domain: "bravo.com", sector: "Roofing", buyer: "Bob Brown", title: "CEO", address: "unconfirmed", href: `${base}/outreach?list=suuchi&card=2` }], sectors: [{ label: "Roofing", value: 1 }], href: `${base}/outreach?list=suuchi` },
  yesterday: { label: "Yesterday", tiles: [tile("Emails sent", 12), tile("Replies", 2), tile("Interested", 1), tile("Bounces", 0)] },
  chart: [{ date: "2026-10-12", label: "Today", sent: 5, replies: 1 }],
  insights: [{ title: "Roofing replies most", text: "By sector.", href: `${base}/stats`, bars: [{ label: "Roofing", value: 8, display: "8% of 25" }] }],
  needs: [{ text: "2 replies are waiting.", action: "Answer", href: `${base}/replies?owner=suuchi` }],
  meetings: [], sendDay: true, ...extra,
});

test("morning email: subject leads with today's send, every section links into the app, text is escaped", () => {
  const email = morningEmail(morning());
  assert.ok(email);
  assert.equal(email.subject, "30 emails go out today, 1 new company on your list, 2 replies yesterday");
  for (const section of ["Today's send", "New list", "Yesterday", "Last 14 days", "Insights", "Needs you"]) assert.ok(email.html.includes(section), section);
  assert.ok(email.html.includes("Bravo &lt;Roofing&gt;") && !email.html.includes("Bravo <Roofing>"));
  assert.ok(email.html.includes(`href="${base}/outreach?list=suuchi&amp;card=2"`));
  assert.ok(email.html.includes("No approval needed"));
  assert.ok(!/[—–]/.test(email.html + email.text));
  assert.match(email.text, /NEW LIST \(1\):\n- Bravo <Roofing> \(Roofing\), Bob Brown/);
});

test("morning email: skipped on a quiet weekend, sent on a weekend with news", () => {
  const quiet = morning({ sendDay: false, needs: [], yesterday: { label: "Friday", tiles: [tile("Emails sent", 0), tile("Replies", 0)] } });
  assert.equal(morningEmail(quiet), null);
  assert.ok(morningEmail({ ...quiet, needs: [{ text: "A reply is waiting.", action: "Answer", href: base }] }));
});

test("morning email: says plainly when auto-send is off or paused", () => {
  assert.match(morningEmail(morning({ send: { ...morning().send, state: "paused", queue: [] } }))!.html, /Auto-send is paused/);
  assert.match(morningEmail(morning({ send: { ...morning().send, state: "off", queue: [] } }))!.html, /Auto-send is off\. 30 emails are ready/);
});

const evening = (extra: Partial<EveningData> = {}): EveningData => ({
  first: "Josh", dateLabel: "Monday, October 12", appHref: `${base}/`,
  tiles: [tile("Emails sent", 9), tile("Replies", 1), tile("LinkedIn", 0), tile("Bounces", 1)],
  sent: [], sentHref: `${base}/drafts/sent`, replies: [{ name: "Ann", company: "Alpha", domain: "alpha.com", note: "Interested", tone: "good", href: `${base}/x` }], repliesHref: `${base}/replies`,
  chart: [], tomorrow: { state: "on", going: 12, window: "9:00am to 11:30am", dayLabel: "tomorrow", followups: 3, unread: 12, href: `${base}/auto-send` },
  tonight: { building: true, listDayLabel: "Tuesday", region: "Southeast and Texas", sectors: ["specialty construction trades such as HVAC, plumbing, electrical and roofing contractors", "equipment rental"], perSeat: 12, listed: 0, note: "Some nights add fewer." },
  needs: [], ...extra,
});

test("evening email: recap, tomorrow and tonight's plan", () => {
  const email = eveningEmail(evening());
  assert.equal(email.subject, "Today: 9 emails sent, 1 reply. Tomorrow: 12 emails");
  assert.ok(email.html.includes("Southeast and Texas") && email.html.includes("specialty construction trades<br>equipment rental"));
  assert.match(email.html, /3 follow-ups also go out on their own/);
  assert.match(email.html, /You haven't read any of them yet/);
  assert.match(email.html, /Nothing went out today/);
  assert.match(email.text, /TONIGHT: list build for Tuesday, leading with Southeast and Texas/);
});

test("evening email: on a Friday it says there is no build tonight", () => {
  const email = eveningEmail(evening({ tonight: { ...evening().tonight, building: false, note: "No list build tonight. The next one runs Sunday night for Monday." } }));
  assert.match(email.html, /No list build tonight/);
  assert.ok(!email.html.includes("Region it leads with"));
});

const touch = (id: string, cardId: string, sentAt: string, extra: Partial<SentTouch> = {}): SentTouch => ({
  id, cardId, sentAt, replyAt: null, replyClass: null, bouncedAt: null, name: "P", title: "CEO", company: "Co", subject: "Hi", industry: "Roofing", role: "Owner or CEO", size: "$10M to $50M", ...extra,
});
const dayOf = (iso: string) => iso.slice(0, 10);

test("chart: sends by send day, replies by the day they came in, out-of-office ignored", () => {
  const days = chartDays([
    touch("a", "a", "2026-10-10T14:00:00Z", { replyAt: "2026-10-12T15:00:00Z", replyClass: "positive" }),
    touch("b", "b", "2026-10-12T14:00:00Z", { replyAt: "2026-10-12T16:00:00Z", replyClass: "ooo" }),
  ], "2026-10-12", dayOf, 3);
  assert.deepEqual(days.map((day) => [day.date, day.sent, day.replies]), [["2026-10-10", 1, 0], ["2026-10-11", 0, 0], ["2026-10-12", 1, 1]]);
  assert.equal(days[2].label, "Today");
});

test("insights: only where there is enough data; sectors compared on first emails", () => {
  assert.deepEqual(insightsFrom([touch("a", "a", "2026-10-12T14:00:00Z")], "2026-10-12", dayOf, { sent: "s", results: "r" }), []);
  const many: SentTouch[] = [];
  for (let i = 0; i < 10; i++) many.push(touch(`r${i}`, `r${i}`, "2026-10-08T14:00:00Z", { industry: "Roofing", ...(i < 3 ? { replyAt: "2026-10-09T10:00:00Z", replyClass: "neutral" } : {}) }));
  for (let i = 0; i < 10; i++) many.push(touch(`p${i}`, `p${i}`, "2026-10-09T14:00:00Z", { industry: "Pest control", ...(i < 1 ? { bouncedAt: "2026-10-09T14:01:00Z" } : {}) }));
  const insights = insightsFrom(many, "2026-10-12", dayOf, { sent: "s", results: "r" });
  assert.equal(insights[0].title, "15% of emails from the last two weeks got a reply");
  assert.equal(insights[1].title, "Roofing replies most");
  assert.deepEqual(insights[1].bars?.map((bar) => bar.display), ["30% of 10", "0% of 10"]);
  assert.equal(insights.at(-1)?.title, "1 of 20 emails bounced this week");
});

test("send days skip weekends", () => {
  assert.equal(previousSendDay("2026-10-12"), "2026-10-09");
  assert.equal(nextSendDay("2026-10-09"), "2026-10-12");
  assert.equal(nextSendDay("2026-10-12"), "2026-10-13");
});

test("night focus: region rotates by the list date, two different sectors", async () => {
  const { nightFocus, LIST_REGIONS } = await import("./list-sectors.ts");
  const a = nightFocus("2026-10-13"), b = nightFocus("2026-10-14");
  assert.equal(a.region, LIST_REGIONS[13 % 4]);
  assert.notEqual(a.region, b.region);
  assert.equal(a.sectors.length, 2);
  assert.notEqual(a.sectors[0], a.sectors[1]);
});
