import { recordCardOutcome, recordManualTouch, type RecordedOutcome } from "@/lib/manual-outreach";
import {
  ownerForSlackUser,
  postSlackEphemeral,
  slackUserAllowed,
  verifySlackRequest,
} from "@/lib/slack";
import { admin } from "@/lib/supabase/admin";
import { after } from "next/server";

export const runtime = "nodejs";

type SlackAction = {
  action_id: string;
  value?: string;
  selected_option?: { value: string } | null;
};

type SlackPayload = {
  type: string;
  user: { id: string; username?: string; name?: string };
  channel?: { id: string };
  actions?: SlackAction[];
};

function label(action: string) {
  return action.replaceAll("_", " ");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySlackRequest(request, rawBody)) return new Response("Invalid Slack signature", { status: 401 });

  try {
    const encoded = new URLSearchParams(rawBody).get("payload");
    if (!encoded) throw new Error("Missing interaction payload");
    const payload = JSON.parse(encoded) as SlackPayload;
    const action = payload.actions?.[0];
    const channel = payload.channel?.id;
    if (!action || !channel) throw new Error("Incomplete Slack action");
    if (action.action_id.startsWith("open_")) return new Response(null, { status: 200 });
    after(() => handleAction(payload, action, channel));
    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack action failed";
    return Response.json({ error: message }, { status: 400 });
  }
}

async function handleAction(payload: SlackPayload, action: SlackAction, channel: string) {
  try {
    if (!slackUserAllowed(payload.user.id)) throw new Error("You are not allowed to change the Night Watch desk");
    const selected = action.selected_option?.value;
    const cardId = action.value ?? selected?.split(":")[0];
    if (!cardId) throw new Error("Missing dossier ID");
    const db = admin();
    const { data: card } = await db.from("cards").select("assigned_to,status").eq("id", cardId).maybeSingle();
    if (!card) throw new Error("Dossier not found");
    const actor = payload.user.username ?? payload.user.name ?? payload.user.id;
    let confirmation = "Night Watch updated the dossier.";

    if (action.action_id === "approve_card") {
      const { error } = await db.from("cards").update({ status: "approved", dismiss_reason: null, snooze_until: null }).eq("id", cardId);
      if (error) throw error;
      confirmation = `Approved by ${actor}. The dossier is ready for manual outreach.`;
    } else if (action.action_id === "snooze_card") {
      const until = new Date();
      until.setDate(until.getDate() + 7);
      const { error } = await db.from("cards").update({ status: "snoozed", snooze_until: until.toISOString().slice(0, 10) }).eq("id", cardId);
      if (error) throw error;
      confirmation = `Snoozed until ${until.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`;
    } else if (action.action_id === "dismiss_card") {
      const { error } = await db.from("cards").update({ status: "dismissed", dismiss_reason: `Dismissed in Slack by ${actor}` }).eq("id", cardId);
      if (error) throw error;
      confirmation = `Dismissed by ${actor}.`;
    } else if (action.action_id === "record_linkedin" || action.action_id === "record_email") {
      const owner = ownerForSlackUser(payload.user.id, card.assigned_to as "josh" | "jenna");
      await recordManualTouch(cardId, action.action_id === "record_email" ? "email" : "linkedin_message", owner);
      confirmation = `${action.action_id === "record_email" ? "Email" : "LinkedIn outreach"} recorded for ${owner}. Learning analytics are now tracking the result.`;
    } else if (action.action_id === "record_outcome") {
      const outcome = selected?.split(":")[1] as RecordedOutcome | undefined;
      if (!outcome) throw new Error("Missing outcome");
      await recordCardOutcome(cardId, outcome);
      confirmation = `${label(outcome)} recorded. Any active cadence for this person was stopped.`;
    } else {
      return;
    }
    await postSlackEphemeral(channel, payload.user.id, `✓ ${confirmation}`);
  } catch (error) {
    await postSlackEphemeral(channel, payload.user.id, `Night Watch could not complete that action: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
