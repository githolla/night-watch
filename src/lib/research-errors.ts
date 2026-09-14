import { ModelOutputError } from "./model-output.ts";

/**
 * Error codes stored on run_accounts rows and shown on the desk. A missing
 * API key, a 401 from Apollo and an unparseable model reply must never look
 * the same to a salesperson.
 */
export type ResearchErrorCode =
  | "config"
  | "upstream_auth"
  | "upstream_rate_limit"
  | "upstream_error"
  | "truncated"
  | "parse"
  | "validation"
  | "db_constraint"
  | "db_error"
  | "timeout"
  | "budget"
  | "cancelled"
  | "unknown";

export class ResearchError extends Error {
  readonly code: ResearchErrorCode;

  constructor(code: ResearchErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ResearchError";
    this.code = code;
  }
}

export type ClassifiedError = { code: ResearchErrorCode; message: string };

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}

function zodSummary(error: { issues?: Array<{ path?: PropertyKey[]; message?: string }> }) {
  const first = error.issues?.[0];
  if (!first) return "Model output did not match the expected schema";
  const path = (first.path ?? []).map(String).join(".") || "(root)";
  return `Model output failed validation at ${path}: ${first.message ?? "invalid"}`;
}

export function classifyResearchError(error: unknown): ClassifiedError {
  if (error instanceof ResearchError) return { code: error.code, message: error.message };
  if (error instanceof ModelOutputError) return { code: error.code === "truncated" ? "truncated" : "parse", message: error.message };

  const message = messageOf(error);
  const record = (error && typeof error === "object" ? error : {}) as { name?: string; status?: unknown; code?: unknown; issues?: unknown };

  if (record.name === "ZodError" || Array.isArray(record.issues)) {
    return { code: "validation", message: zodSummary(record as Parameters<typeof zodSummary>[0]) };
  }

  // The Anthropic workspace hit its spend/usage cap: every call 400s until the limit is raised or resets.
  if (/usage limit|spend limit|workspace.{0,20}limit|regain access/i.test(message)) {
    return { code: "budget", message: `This Anthropic workspace has hit its usage limit — every model call is blocked. Raise the workspace's spend limit in the Anthropic Console (Settings → the workspace → Limits), then retry. Original error: ${message}` };
  }
  const status = typeof record.status === "number" ? record.status : Number.parseInt(/\b(401|403|404|429|5\d\d)\b/.exec(message)?.[1] ?? "", 10);
  // The web-search / web-fetch server tools must be enabled for the org, and the model id must be one this
  // key can use. Both fail every research call, so name them precisely instead of a vague upstream error.
  if (/web[_ ]?search|web[_ ]?fetch/i.test(message)) {
    return { code: "config", message: `The Anthropic web search tool was rejected — enable web search for this API organization in the Anthropic Console (Settings → Capabilities), then retry. Original error: ${message}` };
  }
  if (status === 404 || /model/i.test(message) && /not[_ ]?found|does not (exist|have access)|not (available|allowed|permitted)/i.test(message)) {
    return { code: "config", message: `The model was not found for this API key (${status || "404"}). Set ANTHROPIC_RESEARCH_MODEL to a model this key can use, and confirm web search is enabled. Original error: ${message}` };
  }
  if (status === 401 || status === 403) return { code: "upstream_auth", message: `Upstream service rejected the credentials (${status}): ${message}` };
  if (status === 429) return { code: "upstream_rate_limit", message: `Upstream service is rate limiting requests (429): ${message}` };
  if (status === 400 && /web_search|tool/i.test(message)) {
    return { code: "config", message: `The Anthropic web search tool was rejected. Confirm it is enabled for this API organization: ${message}` };
  }
  if (status >= 500 || status === 529) return { code: "upstream_error", message: `Upstream service error (${status}): ${message}` };
  if (typeof record.status === "number") return { code: "upstream_error", message: `Upstream request failed (${record.status}): ${message}` };

  if (/is missing|not configured|not set/i.test(message)) return { code: "config", message };

  const pgCode = typeof record.code === "string" ? record.code : "";
  if (/^23\d{3}$/.test(pgCode)) return { code: "db_constraint", message: `Database constraint failed (${pgCode}): ${message}` };
  if (/^\d{5}$/.test(pgCode) || /^PGRST/.test(pgCode)) return { code: "db_error", message: `Database error (${pgCode}): ${message}` };

  if (/timed? ?out|ETIMEDOUT|aborted/i.test(message)) return { code: "timeout", message };
  return { code: "unknown", message };
}

/**
 * Check configuration once, before any company is researched, so a missing
 * key fails the run with one specific message instead of N identical rows.
 */
export function researchPreflight() {
  const problems: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY is not set on this deployment");
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)) problems.push("SUPABASE_URL is not set on this deployment");
  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) problems.push("SUPABASE_SECRET_KEY is not set on this deployment");
  if (problems.length) throw new ResearchError("config", `${problems.join("; ")} — no company was researched.`);
}
