export type MessageVariant = { label: "A" | "B"; subject: string; body: string };
export type ScoreDimensions = { relevance: number; specificity: number; trust: number; replyEase: number };
export type PanelReaction = { persona: string; vote: "A" | "B"; concern: string; suggestion: string };
export type SimulationResult = {
  variants: Array<MessageVariant & { score: number; dimensions: ScoreDimensions; summary: string }>;
  panel: PanelReaction[];
  winner: "A" | "B";
  confidence: number;
  experimentId?: string | null;
  model?: string;
  outcomesUsed?: number;
};

export type SimulationInput = {
  channel: "comment" | "connection" | "email";
  personName: string;
  company: string;
  signalSummary: string;
  goal: string;
  context: string;
  focusAreas: string[];
  variants: [MessageVariant, MessageVariant];
  outcomeHistory?: string;
};

export function createChallenger(input: Pick<SimulationInput, "channel" | "personName" | "company" | "signalSummary"> & { control: MessageVariant }): MessageVariant {
  const firstName = input.personName.split(" ")[0];
  const paragraphs = input.control.body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const insight = paragraphs.find((part) => !part.startsWith(firstName) && !part.includes("?")) ?? paragraphs[1] ?? paragraphs[0] ?? "";
  const signal = signalPhrase(input.signalSummary, firstName, input.company);
  const question = input.channel === "comment" ? "How are you thinking about the exception path as this moves into practice?" : "Would the one-page operating pattern be useful?";
  const body = input.channel === "connection"
    ? `Your work on ${signal} caught my eye. Curious how you’re handling the exception path as the system scales.`.slice(0, 300)
    : `${firstName} — your work on ${signal} caught my attention.\n\n${trimSentence(insight, 165)}\n\n${question}`;
  const subject = input.channel === "email" ? shortSubject(input.control.subject || signal) : "";
  return { label: "B", subject, body };
}

export function simulateHeuristically(input: SimulationInput): SimulationResult {
  const scored = input.variants.map((variant) => {
    const dimensions = scoreDimensions(variant, input);
    const score = Math.round(dimensions.relevance * .32 + dimensions.specificity * .24 + dimensions.trust * .24 + dimensions.replyEase * .2);
    const strongest = Object.entries(dimensions).sort((a, b) => b[1] - a[1])[0][0];
    return { ...variant, score, dimensions, summary: `${capitalize(strongest)} is strongest; ${variant.body.split(/\s+/).filter(Boolean).length} words keeps the ask ${dimensions.replyEase > 75 ? "easy to answer" : "slightly demanding"}.` };
  });
  const winner = scored[1].score > scored[0].score ? "B" : "A";
  const confidence = Math.min(92, 64 + Math.abs(scored[0].score - scored[1].score) * 2);
  const byLabel = (label: "A" | "B") => scored.find((variant) => variant.label === label)!;
  const panel: PanelReaction[] = [
    { persona: "The operator", vote: higher("relevance", scored), concern: "Does this clearly connect to the work already underway?", suggestion: `Keep the concrete signal language from variant ${higher("relevance", scored)}.` },
    { persona: "The busy executive", vote: higher("replyEase", scored), concern: "Can I understand and answer this in one scan?", suggestion: `Variant ${higher("replyEase", scored)} creates the lowest-friction next move.` },
    { persona: "The skeptic", vote: higher("trust", scored), concern: "Is the sender earning relevance without manufacturing familiarity?", suggestion: `Use the restrained claim style in variant ${higher("trust", scored)}.` },
    { persona: "The message filter", vote: higher("specificity", scored), concern: "Could this have been sent to any executive?", suggestion: `Variant ${higher("specificity", scored)} contains more account-specific evidence.` },
  ];
  return { variants: [byLabel("A"), byLabel("B")], panel, winner, confidence, model: "heuristic-room-v1" };
}

function scoreDimensions(variant: MessageVariant, input: SimulationInput): ScoreDimensions {
  const body = variant.body.trim();
  const lower = body.toLowerCase();
  const words = body.split(/\s+/).filter(Boolean);
  const contextTerms = meaningful(`${input.signalSummary} ${input.context} ${input.focusAreas.join(" ")}`);
  const overlap = contextTerms.filter((term) => lower.includes(term)).length;
  const hype = (lower.match(/revolutionary|game[- ]changing|best[- ]in[- ]class|guarantee|transformative|amazing|incredible/g) ?? []).length;
  const personalization = [input.personName.split(" ")[0], input.company].filter((value) => lower.includes(value.toLowerCase())).length;
  const ideal = input.channel === "email" ? 70 : input.channel === "connection" ? 34 : 55;
  const lengthPenalty = Math.max(0, Math.abs(words.length - ideal) - 18) * .35;
  return {
    relevance: clamp(55 + overlap * 4 + personalization * 5),
    specificity: clamp(50 + overlap * 5 + (body.match(/\b\d+[\w%–-]*\b/g)?.length ?? 0) * 3 + personalization * 4),
    trust: clamp(88 - hype * 13 - (body.match(/!/g)?.length ?? 0) * 4 - lengthPenalty),
    replyEase: clamp(56 + (body.includes("?") ? 16 : 0) + (/would|want|curious|worth|useful/i.test(body) ? 9 : 0) - lengthPenalty),
  };
}

function higher(key: keyof ScoreDimensions, variants: SimulationResult["variants"]): "A" | "B" {
  return variants[1].dimensions[key] > variants[0].dimensions[key] ? "B" : "A";
}

function meaningful(value: string) {
  const stop = new Set(["about", "after", "again", "being", "company", "could", "from", "have", "into", "just", "more", "that", "their", "there", "they", "this", "with", "would", "your"]);
  return [...new Set(value.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [])].filter((word) => !stop.has(word)).slice(0, 18);
}

function signalPhrase(summary: string, firstName: string, company: string) {
  const cleaned = summary
    .replace(new RegExp(`^${firstName}\\s+(described|shared|announced|outlined|posted)\\s+`, "i"), "")
    .replace(new RegExp(`^${company}\\s+`, "i"), "")
    .replace(/[.]$/, "")
    .toLowerCase();
  return trimSentence(cleaned || "the current operating change", 105);
}

function shortSubject(value: string) {
  const words = value.toLowerCase().replace(/[^a-z0-9’' -]/g, "").split(/\s+/).filter(Boolean);
  return ["question", "on", ...words.filter((word) => !["a", "an", "the", "your"].includes(word)).slice(-3)].slice(0, 5).join(" ");
}

function trimSentence(value: string, max: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function clamp(value: number) { return Math.max(35, Math.min(96, Math.round(value))); }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`); }
