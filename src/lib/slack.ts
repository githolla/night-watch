import { createHmac, timingSafeEqual } from "node:crypto";

export type SlackBlock = Record<string, unknown>;

export interface SlackDeskCard {
  id: string;
  score: number;
  status: string;
  channel: string;
  why_now: string;
  brief?: string | null;
  assigned_to: string;
  accounts: { name: string } | { name: string }[];
  people: { full_name: string; title?: string | null } | { full_name: string; title?: string | null }[];
  signals: { summary: string; source_url: string; type: string } | { summary: string; source_url: string; type: string }[];
}

function relation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function slackText(value: string, max = 2900) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").slice(0, max);
}

function slackUrl(value: string) {
  return value.replaceAll("|", "%7C").replaceAll(">", "%3E");
}

function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function slackConfigured() {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.SLACK_CHANNEL_ID);
}

export function slackChannelId() {
  return process.env.SLACK_CHANNEL_ID ?? "";
}

export function slackUserAllowed(userId: string) {
  const allowlist = (process.env.SLACK_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowlist.length === 0 || allowlist.includes(userId);
}

export function ownerForSlackUser(userId: string, fallback: "josh" | "jenna") {
  if (process.env.SLACK_JENNA_USER_ID === userId) return "jenna";
  if (process.env.SLACK_JOSH_USER_ID === userId) return "josh";
  return fallback;
}

export function verifySlackRequest(request: Request, rawBody: string) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const received = request.headers.get("x-slack-signature");
  if (!secret || !timestamp || !received) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 60 * 5) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function slackApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!response.ok || !result.ok) throw new Error(`Slack ${method} failed: ${result.error ?? response.statusText}`);
  return result;
}

export function buildDeskBlocks(cards: SlackDeskCard[], options?: { compact?: boolean }): SlackBlock[] {
  const compact = options?.compact ?? false;
  // Four framing blocks plus four blocks per card stays under Slack's 50-block limit.
  const shown = cards.slice(0, compact ? 5 : 11);
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: "Night Watch — Morning Desk", emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: shown.length
          ? `*${cards.length} dossier${cards.length === 1 ? "" : "s"} ready* · ${shown.filter((card) => card.score >= 75).length} high priority shown · Review the evidence before reaching out.`
          : "*The desk is clear.* No new dossiers met the score threshold this morning.",
      },
    },
    { type: "context", elements: [{ type: "mrkdwn", text: `Night Watch researched the public web overnight · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}` }] },
    { type: "divider" },
  ];

  for (const card of shown) {
    const account = relation(card.accounts);
    const person = relation(card.people);
    const signal = relation(card.signals);
    const dossierUrl = `${appUrl()}/desk?card=${encodeURIComponent(card.id)}`;
    const sourceUrl = signal.source_url?.startsWith("http") ? signal.source_url : dossierUrl;
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${slackText(person.full_name)}* · ${slackText(person.title ?? "Decision maker")}\n*${slackText(account.name)}*  |  Score *${card.score}*  |  ${slackText(card.channel.replaceAll("_", " ").toUpperCase())}\n${slackText(card.why_now, 900)}`,
        },
        accessory: { type: "button", text: { type: "plain_text", text: "Open dossier" }, url: dossierUrl, action_id: `open_${card.id}` },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `*Source:* <${slackUrl(sourceUrl)}|${slackText(signal.summary, 850)}> · ${slackText(signal.type.replaceAll("_", " "))}` }],
      },
      {
        type: "actions",
        block_id: `card_${card.id}`,
        elements: [
          { type: "button", text: { type: "plain_text", text: "Approve" }, style: "primary", action_id: "approve_card", value: card.id },
          { type: "button", text: { type: "plain_text", text: "Snooze 7d" }, action_id: "snooze_card", value: card.id },
          { type: "button", text: { type: "plain_text", text: "Dismiss" }, style: "danger", action_id: "dismiss_card", value: card.id, confirm: { title: { type: "plain_text", text: "Dismiss dossier?" }, text: { type: "mrkdwn", text: "This removes it from the active morning desk." }, confirm: { type: "plain_text", text: "Dismiss" }, deny: { type: "plain_text", text: "Keep" } } },
          { type: "button", text: { type: "plain_text", text: "I sent LinkedIn" }, action_id: "record_linkedin", value: card.id },
          { type: "button", text: { type: "plain_text", text: "I sent email" }, action_id: "record_email", value: card.id },
          {
            type: "static_select",
            action_id: "record_outcome",
            placeholder: { type: "plain_text", text: "Record outcome" },
            options: [
              ["Meeting booked", "meeting"], ["Positive reply", "positive"], ["Referral", "referral"],
              ["Neutral", "neutral"], ["Objection", "objection"], ["Out of office", "ooo"], ["Negative", "negative"],
            ].map(([text, value]) => ({ text: { type: "plain_text", text }, value: `${card.id}:${value}` })),
          },
        ],
      },
      { type: "divider" },
    );
  }
  return blocks;
}

export async function sendMorningSlack(cards: SlackDeskCard[]) {
  if (!slackConfigured()) return { delivered: false, reason: "Slack is not configured" };
  const text = cards.length ? `${cards.length} Night Watch dossiers are ready.` : "Night Watch completed. The desk is clear.";
  const result = await slackApi<{ ts: string; channel: string }>("chat.postMessage", {
    channel: slackChannelId(),
    text,
    blocks: buildDeskBlocks(cards),
    unfurl_links: false,
    unfurl_media: false,
  });
  return { delivered: true, ts: result.ts, channel: result.channel };
}

export async function sendSlackTest() {
  if (!slackConfigured()) throw new Error("Add SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and SLACK_CHANNEL_ID first");
  return slackApi<{ ts: string; channel: string }>("chat.postMessage", {
    channel: slackChannelId(),
    text: "Night Watch is connected.",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Night Watch is on duty", emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: "The morning desk can now arrive here with source-backed dossiers and review controls." } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Night Watch" }, url: appUrl(), action_id: "open_night_watch" }] },
    ],
  });
}

export async function postSlackEphemeral(channel: string, user: string, text: string) {
  return slackApi("chat.postEphemeral", { channel, user, text });
}
