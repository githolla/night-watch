export async function gmailTokenRequest(body: URLSearchParams, deps: { fetcher?: typeof fetch; wait?: (ms: number) => Promise<void> } = {}) {
  const fetcher = deps.fetcher ?? fetch;
  const wait = deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000) });
    } catch {
      if (attempt === 2) throw new Error("Gmail token refresh temporarily unavailable (network timeout). No email or call was sent.");
      await wait(1000 * 2 ** attempt);
      continue;
    }
    const value: unknown = await response.json().catch(() => null);
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (response.ok && typeof record.access_token === "string" && record.access_token) return record.access_token;
    const retry = response.status === 429 || response.status >= 500;
    if (retry && attempt < 2) { await wait(1000 * 2 ** attempt); continue; }
    const reason = typeof record.error === "string" && /^[a-z_]+$/.test(record.error) ? record.error : "refresh_failed";
    throw new Error(`Unable to refresh Gmail access (${response.status}, ${reason}).${reason === "invalid_grant" ? " Reconnect this Google account in Settings." : ""}`);
  }
  throw new Error("Unable to refresh Gmail access.");
}
