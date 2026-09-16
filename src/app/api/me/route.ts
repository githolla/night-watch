import { requireUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ id: user.id, email: user.email, name: user.name, owner: user.owner, role: user.role });
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
}
