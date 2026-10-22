export const VOICE_TEST_DURATION_SECONDS = 600;

export const VOICE_TURN_TIMING = {
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
  stopSpeakingPlan: { numWords: 0, voiceSeconds: 0.15, backoffSeconds: 1.3 },
};

export function spokenEmailAddress(email: string): string {
  const [local, domain] = email.toLowerCase().split("@");
  const symbol = (char: string) => char === "." ? "dot" : char === "-" ? "hyphen" : char === "_" ? "underscore" : char;
  return `${Array.from(local).map(symbol).join(" ")} at ${Array.from(domain).map(symbol).join(" ")}`;
}
