/**
 * Parsing of Anthropic Messages API responses into JSON.
 *
 * When a server-side tool such as web search runs, the reply is not a single
 * JSON block. It is a sequence of narration text, tool-use blocks, tool-result
 * blocks, more narration, and finally the answer. Only the final text block is
 * the answer, so that is the only block parsed here.
 */

export type ModelOutputErrorCode = "truncated" | "parse" | "empty";

export class ModelOutputError extends Error {
  readonly code: ModelOutputErrorCode;
  readonly stopReason: string | null;

  constructor(code: ModelOutputErrorCode, message: string, stopReason: string | null) {
    super(message);
    this.name = "ModelOutputError";
    this.code = code;
    this.stopReason = stopReason;
  }
}

type TextLike = { type: string; text?: string };

const PREVIEW_LENGTH = 300;

function preview(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > PREVIEW_LENGTH ? `${compact.slice(0, PREVIEW_LENGTH)}…` : compact;
}

/** The last text block of a response, or null when the response has none. */
export function finalTextBlock(blocks: ReadonlyArray<TextLike>): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) return block.text;
  }
  return null;
}

function fencedBlocks(text: string) {
  const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  return matches.map((match) => match[1].trim()).filter(Boolean);
}

/**
 * Every balanced top-level `{…}` or `[…]` span in the text, in document order.
 * String literals are respected so braces inside quoted text do not count.
 */
function balancedSpans(text: string) {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" || char === "]") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return spans;
}

function tryParse(candidate: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    return { ok: false };
  }
}

/**
 * Extract JSON from a single text block. In order: the trimmed block itself,
 * the last fenced ```json block, then the last balanced object span. The last
 * candidate wins because a schema example, when the model includes one, comes
 * before the real answer.
 */
export function extractJson(text: string): unknown | undefined {
  const direct = tryParse(text.trim());
  if (direct.ok) return direct.value;
  const fenced = fencedBlocks(text);
  for (let index = fenced.length - 1; index >= 0; index -= 1) {
    const attempt = tryParse(fenced[index]);
    if (attempt.ok) return attempt.value;
  }
  const spans = balancedSpans(text);
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const attempt = tryParse(spans[index]);
    if (attempt.ok) return attempt.value;
  }
  return undefined;
}

/**
 * Parse the JSON answer out of a Messages API response. Throws a
 * ModelOutputError whose message carries the stop reason and the first 300
 * characters of the text, so a failure is diagnosable from the UI.
 */
export function parseModelJson(blocks: ReadonlyArray<TextLike>, stopReason: string | null | undefined): unknown {
  const reason = stopReason ?? null;
  const text = finalTextBlock(blocks);
  if (reason === "max_tokens") {
    throw new ModelOutputError(
      "truncated",
      `Model output was cut off before the answer completed (stop_reason=max_tokens). Raise max_tokens or shorten the request. Last text: ${preview(text ?? "")}`,
      reason,
    );
  }
  if (text === null) {
    throw new ModelOutputError("empty", `Model returned no text block to parse (stop_reason=${reason ?? "unknown"}).`, reason);
  }
  const value = extractJson(text);
  if (value === undefined) {
    throw new ModelOutputError(
      "parse",
      `Model reply was not JSON (stop_reason=${reason ?? "unknown"}). Text: ${preview(text)}`,
      reason,
    );
  }
  return value;
}
