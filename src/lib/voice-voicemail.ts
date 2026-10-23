export function voiceVoicemail(input: { firstName?: string; sentSpoken?: string; subject?: string | null } = {}): string {
  const first = input.firstName?.replace(/[^\p{L}\p{N}' -]/gu, "").trim().slice(0, 30);
  const topic = input.subject?.replace(/^one AI project:\s*/i, "").replace(/[\r\n]/g, " ").trim().slice(0, 80);
  return `Hi${first ? ` ${first}` : ""}, this is Alex with Nine Six Seven. I'm following up on our email${topic ? ` about ${topic}` : ""}${input.sentSpoken ? `, sent ${input.sentSpoken}` : ""}. If it's relevant, please reply to that email or call two zero one, five eight one, four three zero nine. To stop follow-ups, reply stop to our email. Thank you.`;
}
