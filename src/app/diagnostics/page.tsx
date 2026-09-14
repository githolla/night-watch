import Anthropic from "@anthropic-ai/sdk";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { researchModel, searchModel } from "@/lib/models";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Probe = { label: string; model: string; search: boolean };
type Result = Probe & { ok: boolean; status: string; detail: string };

/** One real call to the Anthropic API, reporting the raw outcome — success or the exact error. */
async function probe(client: Anthropic, p: Probe): Promise<Result> {
  try {
    const response = await client.messages.create({
      model: p.model,
      max_tokens: 64,
      ...(p.search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 } as unknown as Anthropic.Messages.ToolUnion] } : {}),
      messages: [{ role: "user", content: p.search ? "Search the web for recent Anthropic news and reply in one sentence." : "Reply with the word ok." }],
    }, { timeout: 60_000, maxRetries: 0 });
    return { ...p, ok: true, status: "200", detail: `stop_reason=${response.stop_reason}, served model=${response.model}` };
  } catch (error) {
    const record = (error ?? {}) as { status?: unknown; message?: unknown; name?: unknown };
    return { ...p, ok: false, status: String(record.status ?? record.name ?? "error"), detail: String(record.message ?? error) };
  }
}

export default async function DiagnosticsPage() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)) redirect("/setup");
  await requireUser();
  const key = process.env.ANTHROPIC_API_KEY;
  const probes: Probe[] = [
    { label: "Research model, no web search", model: researchModel(), search: false },
    { label: "Research model + web search", model: researchModel(), search: true },
    { label: "Search model + web search", model: searchModel(), search: true },
    { label: "Sonnet 4.5 + web search", model: "claude-sonnet-4-5", search: true },
    { label: "Sonnet 5, no web search", model: "claude-sonnet-5", search: false },
    { label: "Haiku 4.5, no web search", model: "claude-haiku-4-5", search: false },
  ];
  const client = key ? new Anthropic({ apiKey: key }) : null;
  const results: Result[] = client ? await Promise.all(probes.map((p) => probe(client, p))) : [];

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <section className="targets-head"><div><span className="eyebrow">Diagnostics</span><h1>What the API key can actually do</h1><p>Live calls to the Anthropic API with this deployment&apos;s key. Each row is a real request; the detail is the raw success or error. Screenshot this page.</p></div></section>
      {!key && <p className="notice error">ANTHROPIC_API_KEY is not set on this deployment.</p>}
      {key && <section className="target-results"><div className="table-wrap"><table className="data-table"><thead><tr><th>Test</th><th>Model</th><th>Result</th><th>Detail</th></tr></thead><tbody>
        {results.map((r) => <tr key={r.label}>
          <td><strong>{r.label}</strong></td>
          <td><code>{r.model}</code></td>
          <td><span className={`status-chip ${r.ok ? "ok" : "error"}`}>{r.ok ? "OK" : `FAIL ${r.status}`}</span></td>
          <td><small style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.detail}</small></td>
        </tr>)}
      </tbody></table></div></section>}
    </main>
  </div>;
}
