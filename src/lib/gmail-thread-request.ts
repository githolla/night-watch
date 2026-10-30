type Fetcher = typeof fetch;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
export async function gmailThreadRequest(token: string, id: string, deps: { fetcher?: Fetcher; wait?: (ms: number) => Promise<void> } = {}) {
  const fetcher = deps.fetcher ?? fetch;
  const wait = deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=full`, { signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${token}` } });
    if (response.ok) return response;
    const body: unknown = await response.json().catch(() => null);
    const error = object(object(body).error);
    const errors = Array.isArray(error.errors) ? error.errors : [];
    const reason = errors.map(item => object(item).reason).find((reason): reason is string => typeof reason === "string" && /^[a-zA-Z_]+$/.test(reason));
    const transient = response.status === 429 || response.status >= 500 || response.status === 403 && ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(reason ?? "");
    if (!transient || attempt === 2) throw new Error(`Gmail thread read failed: ${response.status}${reason ? ` (${reason})` : ""}`);
    await wait(1000 * 2 ** attempt);
  }
  throw new Error("Could not verify the Gmail conversation.");
}
