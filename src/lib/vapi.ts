import { z } from "zod";

export async function vapiRequest(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const key = process.env.VAPI_API_KEY?.trim();
  if (!key) throw new Error("VAPI_API_KEY is not configured on this deployment.");
  const response = await fetch(`https://api.vapi.ai${path}`, {
    method, cache: "no-store", signal: AbortSignal.timeout(25_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let fields: string[] = [];
    if (response.status === 400) {
      const parsed = z.object({ message: z.union([z.string(), z.array(z.string())]) }).safeParse(await response.json().catch(() => null));
      const messages = parsed.success ? typeof parsed.data.message === "string" ? [parsed.data.message] : parsed.data.message : [];
      fields = [...new Set(messages.flatMap(message => {
        const field = message.match(/^(voice(?:\.[A-Za-z0-9_]+)*|startSpeakingPlan(?:\.[A-Za-z0-9_]+)*|stopSpeakingPlan(?:\.[A-Za-z0-9_]+)*|firstMessageMode)\s/)?.[1];
        return field ? [field] : [];
      }))];
    }
    throw new Error(`Vapi request failed (${response.status}).${fields.length ? ` Check configuration fields: ${fields.join(", ")}.` : ""}`);
  }
  return response.json();
}

const assistantSummary = z.object({ id: z.string(), name: z.string().optional(), model: z.object({ provider: z.string().optional(), model: z.string().optional() }).optional() });
const numberSummary = z.object({ id: z.string(), number: z.string().optional(), provider: z.string().optional(), assistantId: z.string().nullable().optional() });

export async function vapiStatus() {
  const [assistants, numbers] = await Promise.all([vapiRequest("/assistant?limit=100"), vapiRequest("/phone-number")]);
  return {
    connected: true,
    assistants: z.array(assistantSummary).parse(assistants),
    numbers: z.array(numberSummary).parse(numbers),
    configuredAssistantId: process.env.VAPI_ASSISTANT_ID ?? null,
    webhookConfigured: Boolean(process.env.VAPI_WEBHOOK_SECRET),
  };
}
