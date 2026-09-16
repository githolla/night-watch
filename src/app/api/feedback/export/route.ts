import { requireAdmin } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

type Row = { created_at: string; user_name: string | null; user_email: string | null; path: string; category: string; rating: number | null; message: string; user_agent: string | null };

function cell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export async function GET() {
  try {
    await requireAdmin();
    const { data } = await admin().from("feedback").select("created_at,user_name,user_email,path,category,rating,message,user_agent").order("created_at", { ascending: false }).limit(10000);
    const rows = (data ?? []) as Row[];
    const header = ["timestamp_utc", "timestamp_local", "user", "email", "page", "category", "rating", "message", "user_agent"];
    const lines = rows.map((r) => [
      r.created_at,
      new Date(r.created_at).toLocaleString("en-US"),
      r.user_name ?? "",
      r.user_email ?? "",
      r.path,
      r.category,
      r.rating ?? "",
      r.message,
      r.user_agent ?? "",
    ].map(cell).join(","));
    const csv = [header.join(","), ...lines].join("\r\n");
    return new Response("﻿" + csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="night-watch-feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Export failed" }, { status: 400 });
  }
}
