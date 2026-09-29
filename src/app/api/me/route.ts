import { requireActualUser, requireUser } from "@/lib/auth";
export async function GET() {
  try {
    const actual = await requireActualUser();
    try {
      const user = await requireUser();
      return Response.json({ ...user, canAct: actual.role === "admin" }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ ...actual, canAct: actual.role === "admin", actingError: true }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch { return Response.json({ error: "Unauthorized" }, { status: 401 }); }
}
