import { requireUser } from "@/lib/auth";
import { eveningEmail, morningEmail } from "@/lib/daily-email";
import { loadEveningEmail, loadMorningEmail } from "@/lib/daily-email-data";

/** The morning or evening email as it would go out right now, for the signed-in seat (an admin may pick either). */
export async function GET(request: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return new Response(null, { status: 401 });
  const url = new URL(request.url);
  const asked = url.searchParams.get("owner");
  const owner = user.role === "admin" && (asked === "josh" || asked === "suuchi") ? asked : user.owner;
  const base = (process.env.APP_URL ?? url.origin).replace(/\/$/, "");
  const email = url.searchParams.get("kind") === "evening"
    ? eveningEmail(await loadEveningEmail(owner, base))
    // A preview always shows the morning email, even on a quiet weekend when the real one would be skipped.
    : morningEmail({ ...(await loadMorningEmail(owner, base)), sendDay: true });
  const html = email ? email.html.replace("<body", `<body data-subject="${email.subject.replace(/"/g, "&quot;")}"`) : "<p>Nothing to report.</p>";
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
