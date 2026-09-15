import type { SupabaseClient } from "@supabase/supabase-js";
import type { Owner } from "./types.ts";

/**
 * How the connected mailbox presents on an outreach email: a display name and
 * title on the From line (so a recipient sees a senior person, not a bare
 * address), a signature appended to the body, and a CC list. Stored per owner
 * slot; the mailbox address itself is the owner's Gmail connection.
 */
export type SenderProfile = { fromName: string; title: string; signature: string; cc: string[] };
const EMPTY: SenderProfile = { fromName: "", title: "", signature: "", cc: [] };

export async function senderProfile(db: SupabaseClient, owner: Owner): Promise<SenderProfile> {
  const { data } = await db.from("sender_profiles").select("from_name,title,signature,cc").eq("owner", owner).maybeSingle();
  if (!data) return EMPTY;
  return {
    fromName: (data.from_name as string | null) ?? "",
    title: (data.title as string | null) ?? "",
    signature: (data.signature as string | null) ?? "",
    cc: Array.isArray(data.cc) ? (data.cc as string[]) : [],
  };
}

/** The Gmail From header value: `Name, Title <email>` when a name is set, otherwise the bare address. */
export function fromHeader(profile: SenderProfile, email: string) {
  const label = [profile.fromName, profile.title].filter((part) => part.trim()).join(", ");
  return label ? `${label} <${email}>` : email;
}

/** Body with the signature appended once; the caller adds the opt-out line after this. */
export function withSignature(body: string, profile: SenderProfile) {
  return profile.signature.trim() ? `${body.trim()}\n\n${profile.signature.trim()}` : body.trim();
}
