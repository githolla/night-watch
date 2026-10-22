export const VOICE_TEST_DURATION_SECONDS = 600;

export const VOICE_TURN_TIMING = {
  firstMessageMode: "assistant-waits-for-user",
  firstMessageInterruptionsEnabled: true,
  startSpeakingPlan: {
    waitSeconds: 0.5,
    smartEndpointingPlan: {
      provider: "livekit",
      waitFunction: "(20 + 500 * sqrt(x) + 2500 * x^3 + 700 + 4000 * max(0, x-0.5)) / 2",
    },
    customEndpointingRules: [
      { type: "assistant", regex: "(email|e-mail|address|spell|invitation)", timeoutSeconds: 2.5 },
      { type: "customer", regex: "(@|\\bat\\b|\\bdot\\b|\\bno dots?\\b|\\bno hyphens?\\b)", timeoutSeconds: 2.5 },
    ],
  },
  stopSpeakingPlan: { numWords: 1, voiceSeconds: 0.25, backoffSeconds: 1.0 },
};

export function spokenEmailAddress(email: string): string {
  const [local, domain] = email.toLowerCase().split("@");
  const symbol = (char: string) => char === "." ? "dot" : char === "-" ? "hyphen" : char === "_" ? "underscore" : char;
  return `${Array.from(local).map(symbol).join(" ")} at ${Array.from(domain).map(symbol).join(" ")}`;
}

export const VOICE_BRAND_REPLACEMENT = {
  type: "regex",
  regex: "(?<![\\w@.-])(?:[Nn]ine|9)[-\\s]67(?![\\w@-]|\\.[a-zA-Z])",
  value: "Nine Six Seven",
};
const brandChunkPlan = { enabled: true, formatPlan: { enabled: true, replacements: [VOICE_BRAND_REPLACEMENT] } };
export const VOICE_CHOICES = {
  jess: { provider: "vapi", voiceId: "Jess" },
  savannah: { provider: "vapi", voiceId: "Savannah", version: 1, chunkPlan: brandChunkPlan },
  clara: { provider: "vapi", voiceId: "Clara", version: 2, chunkPlan: brandChunkPlan },
  sid: { provider: "vapi", voiceId: "Sid", version: 2, chunkPlan: brandChunkPlan },
} as const;
export type VoiceChoice = keyof typeof VOICE_CHOICES;
