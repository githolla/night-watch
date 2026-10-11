/** Moves a card to a new status from the browser: what Meeting booked, Close and Reopen do on a reply. */
export async function setCardStatus(cardId: string, status: "meeting" | "archived" | "replied"): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/cards/${cardId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const json = await response.json().catch(() => ({})) as { error?: string };
    return response.ok ? { ok: true } : { ok: false, error: json.error ?? "Not saved. Try again." };
  } catch {
    return { ok: false, error: "Not saved: the connection dropped." };
  }
}
