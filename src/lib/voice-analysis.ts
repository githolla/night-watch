import { z } from "zod";
import { voiceAnalysis } from "./voice-policy.ts";
import { vapiRequest } from "./vapi.ts";
export const VOICE_OUTPUT_NAME = "Nightwatch email follow-up outcome v2";
export function voiceStructuredResult(artifact: unknown): unknown {
  const parsed = z.object({ structuredOutputs: z.record(z.string(), z.object({ name: z.string().optional(), result: z.unknown().optional() })).optional() }).safeParse(artifact);
  if (!parsed.success) return null;
  return Object.values(parsed.data.structuredOutputs ?? {}).find(item => item.name === VOICE_OUTPUT_NAME)?.result ?? null;
}
export async function ensureVoiceStructuredOutput() {
  const item = z.object({ id: z.uuid(), name: z.string() });
  const response = z.union([z.array(item), z.object({ results: z.array(item) })]).parse(await vapiRequest("/structured-output"));
  const listed = Array.isArray(response) ? response : response.results;
  const found = listed.find(item => item.name === VOICE_OUTPUT_NAME);
  if (found) return found.id;
  const schema = z.toJSONSchema(voiceAnalysis);
  const created = z.object({ id: z.uuid() }).parse(await vapiRequest("/structured-output", "POST", {
    name: VOICE_OUTPUT_NAME, type: "ai", schema,
    description: "Extract explicit prospect statements only. Use null for unknowns, not friendliness as interest. A request is not a confirmed action. Never infer an invitation was sent from the conversation. Meeting, suppression, callback and email results are reconciled against Nightwatch operational records. Internal roleplay is not a real prospect outcome.",
  }));
  return created.id;
}
