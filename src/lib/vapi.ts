import { z } from "zod";

export async function vapiRequest(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const key = process.env.VAPI_API_KEY?.trim();
  if (!key) throw new Error("VAPI_API_KEY is not configured on this deployment.");
  const response = await fetch(`https://api.vapi.ai${path}`, {
    method, cache: "no-store", signal: AbortSignal.timeout(25_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Vapi request failed (${response.status}).`);
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
