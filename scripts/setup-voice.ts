import { voiceAssistantPayload } from "../src/lib/voice-assistant.ts";
import { vapiRequest } from "../src/lib/vapi.ts";

const id = process.env.VAPI_ASSISTANT_ID;
const secret = process.env.VAPI_WEBHOOK_SECRET;
if (!id || !secret) throw new Error("Set VAPI_ASSISTANT_ID and VAPI_WEBHOOK_SECRET before configuring the assistant.");
const current = await vapiRequest(`/assistant/${encodeURIComponent(id)}`);
const payload = voiceAssistantPayload(current, secret);
if (process.argv.includes("--apply")) {
  await vapiRequest(`/assistant/${encodeURIComponent(id)}`, "PATCH", payload);
  console.log("Updated assistant tools and instructions. No calls were placed and no phone number was reassigned. Run internal tests before prospect calls.");
} else console.log("Preview passed. Model and voice will be preserved; instructions and calendar tools will be updated. Run with --apply after deploying matching assistant ID and webhook secret to Vercel.");
