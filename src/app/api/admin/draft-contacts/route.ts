import { requireUser } from "@/lib/auth";
import { angleFor, composeContactDraft, rolesFromSignal } from "@/lib/contact-draft";
import { isRealContact } from "@/lib/clean";
import { isLikelyPersonName } from "@/lib/pipeline";
import { senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const maxDuration = 300;

type CardRow = {
  id: string; signal_id: string; account_id: string; person_id: string; score: number;
  brief: string; why_now: string; channel: string; assigned_to: string;
  score_breakdown: Record<string, unknown> | null;
  signals: { raw: Record<string, unknown> | null } | null;
  accounts: { name: string; domain?: string } | null;
};

type PersonRow = { id: string; full_name: string; title: string | null; level: string | null; email: string | null; email_status: string | null };

// The person_level enum is owner | influencer | adjacent | unknown (migration 0001). An earlier version
// ranked c_suite/vp/director/manager — none of which exist — so every contact tied on 6, the comparator
// returned 0 for every pair, and "most senior first" picked whatever order the database happened to return.
const LEVEL_RANK: Record<string, number> = { owner: 0, influencer: 1, adjacent: 2, unknown: 3 };
const EMAIL_RANK: Record<string, number> = { verified: 0, guessed: 1, unverified: 2, none: 3 };

/**
 * Write and save a draft for every contact worth emailing at each company, so the list is ready to work
 * rather than needing a button pressed per person.
 *
 * No model call, so the whole list costs nothing. Each draft is angled at what that person's role owns and
 * grounded in the company's own signal, and lands as that person's own card — their draft, their send,
 * their follow-ups, their History.
 *
 * Paged by offset over the source cards; the caller drains it. Nothing existing is overwritten: a contact
 * who already has a card for this signal is skipped, including the card's own contact.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Math.floor(Number(body.offset))) : 0;
    // A cap per company, because a company can carry forty contacts and drafting all of them would bury
    // the desk in people nobody intends to write to.
    const perCompany = Math.max(1, Math.min(10, Math.floor(Number(body?.perCompany)) || 4));
    // Every row this endpoint writes has status 'new', which matches its own source filter. Paging by
    // offset over that set meant the run kept finding its own output: the count grew faster than the
    // cursor, `done` was never true, and a press that should have written ~700 rows wrote thousands and
    // then reported success. `before` freezes the source set to cards that existed when the drain started.
    const before = typeof body?.before === "string" && body.before ? body.before : new Date().toISOString();
    const PAGE = 15;
    const db = admin();

    const { data, count, error: sourceError } = await db.from("cards")
      .select("id,signal_id,account_id,person_id,score,score_breakdown,brief,why_now,channel,assigned_to,signals(raw),accounts(name,domain)", { count: "exact" })
      .in("status", ["new", "approved", "edited"])
      .lt("created_at", before)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    // Never report a failed read as a finished run.
    if (sourceError) return Response.json({ error: sourceError.message }, { status: 400 });
    const cards = (data ?? []) as unknown as CardRow[];

    // Looked up per card's assigned seat, not once for whoever pressed the button: a draft introduces the
    // person who will send it. Cached, since a page of cards is usually one or two seats.
    const profiles = new Map<string, Awaited<ReturnType<typeof senderProfile>>>();
    const profileFor = async (owner: string) => {
      const cached = profiles.get(owner);
      if (cached) return cached;
      const fresh = await senderProfile(db, owner as Owner);
      profiles.set(owner, fresh);
      return fresh;
    };
    let written = 0;
    let skipped = 0;
    let failed = 0;

    for (const card of cards) {
      const [{ data: people, error: peopleError }, { data: siblings, error: siblingsError }] = await Promise.all([
        db.from("people").select("id,full_name,title,level,email,email_status")
          .eq("account_id", card.account_id).eq("do_not_contact", false).not("email", "is", null)
          .order("level", { ascending: true }).order("full_name", { ascending: true }).limit(60),
        // Scoped to the ACCOUNT, not the signal: a company with two open signals would otherwise card the
        // same top contacts twice, and the operator would send one human two cold emails days apart.
        db.from("cards").select("person_id").eq("account_id", card.account_id),
      ]);
      // `taken` is the ONLY thing standing between this and overwriting a draft that has already been
      // edited or sent. supabase-js returns errors rather than throwing, so a failed read would have
      // produced an empty set and rewritten sent outreach back to "new". Skip the company instead.
      if (peopleError || siblingsError) { failed += 1; continue; }
      const taken = new Set<string>((siblings ?? []).map((row) => row.person_id as string));
      const ranked = ((people ?? []) as PersonRow[])
        .filter((person) => !taken.has(person.id))
        // A personal first-touch to recruiting@ reads as a bot and burns sending reputation on a mailbox
        // that never replies.
        .filter((person) => isRealContact(person))
        // The desk applies this too, so a contact failing it would get a draft it could never display.
        .filter((person) => isLikelyPersonName(person.full_name))
        .sort((a, b) =>
          (LEVEL_RANK[a.level ?? "unknown"] ?? 3) - (LEVEL_RANK[b.level ?? "unknown"] ?? 3)
          || (EMAIL_RANK[a.email_status ?? "none"] ?? 3) - (EMAIL_RANK[b.email_status ?? "none"] ?? 3)
          || a.full_name.localeCompare(b.full_name));

      // Take a SPREAD of functions rather than the four most senior. Picking purely by seniority meant four
      // co-founders at one company, who all read as the same angle, so their drafts made the same argument
      // in nearly the same words — the mail merge this feature exists to avoid, reintroduced by the sort.
      // It is also better outreach: a CFO and an engineering lead are two ways into a company, four
      // co-founders are one.
      const byAngle = new Map<string, PersonRow[]>();
      for (const person of ranked) {
        const key = angleFor(person.title ?? "");
        byAngle.set(key, [...(byAngle.get(key) ?? []), person]);
      }
      const candidates: PersonRow[] = [];
      // One from each function in seniority order, then a second from each, until the cap is reached.
      for (let round = 0; candidates.length < perCompany && round < 10; round += 1) {
        let addedThisRound = false;
        for (const group of byAngle.values()) {
          if (candidates.length >= perCompany) break;
          const next = group[round];
          if (!next) continue;
          candidates.push(next);
          addedThisRound = true;
        }
        if (!addedThisRound) break;
      }
      if (!candidates.length) { skipped += 1; continue; }

      const raw = card.signals?.raw ?? {};

      const roles = rolesFromSignal(raw);

      const profile = await profileFor(card.assigned_to);
      const rows = candidates.map((person, index) => {
        const draft = composeContactDraft({
          // Two colleagues who land on the same angle must not draw the same wording by chance.
          variantSalt: index,
          company: card.accounts?.name ?? "",
          domain: card.accounts?.domain,
          personName: person.full_name,
          personTitle: person.title ?? "",
          whyNow: card.why_now,
          operatingNeed: typeof raw.operating_need === "string" ? raw.operating_need : null,
          roles,
          senderName: profile.fromName,
          senderTitle: profile.title,
          greeting: profile.greeting,
          signoff: profile.signoff,
          intro: profile.intro,
        });
        return {
          signal_id: card.signal_id, person_id: person.id, account_id: card.account_id,
          score: card.score, brief: card.brief, why_now: card.why_now, channel: card.channel,
          // Without the source card's breakdown these inherit '{}', and the next research run rescores them
          // from recency alone — sinking them to the bottom of the desk or archiving them outright.
          score_breakdown: card.score_breakdown ?? {},
          assigned_to: card.assigned_to, email_subject: draft.subject, email_body: draft.body, status: "new",
        };
      });
      // ignoreDuplicates so a conflict can never take the DO UPDATE branch: `taken` above is a check, not a
      // guarantee, and nothing here may rewrite a draft somebody has edited or already sent.
      const { data: inserted, error } = await db.from("cards")
        .upsert(rows, { onConflict: "signal_id,person_id", ignoreDuplicates: true }).select("id");
      if (error) failed += 1; else written += inserted?.length ?? 0;
    }

    const nextOffset = offset + cards.length;
    const remaining = Math.max(0, (count ?? nextOffset) - nextOffset);
    return Response.json({ written, skipped, failed, scanned: cards.length, before, offset: nextOffset, remaining, done: cards.length < PAGE || remaining === 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not write the drafts" }, { status: 400 });
  }
}
