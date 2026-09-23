import { admin } from "@/lib/supabase/admin";
import { curatedDrafts } from "@/lib/curated-worklist";
import { domainKey } from "@/lib/recipient-research";
import { senderProfile } from "@/lib/sender";
import { composeContactDraft } from "@/lib/contact-draft";
import type { AppUser } from "@/lib/users";

/** Prepare saved worklist data without sending or replacing existing drafts. */
export async function preparePriorityDraft(domain: string, me: AppUser, db = admin()) {
    const selected = curatedDrafts.find(row => domainKey(row.domain) === domainKey(domain));
    if (!selected?.buyer.name) return Response.json({ error: "Choose a selected company with a verified buyer." }, { status: 400 });
    const accountResult = await db.from("accounts").select("id,status").eq("domain", selected.domain).maybeSingle();
    if (accountResult.error) throw accountResult.error;
    let account = accountResult.data;
    if (!account) {
      const result = await db.from("accounts").upsert({ name: selected.company, domain: selected.domain, vertical: selected.sector, status: "active", outreach: true }, { onConflict: "domain", ignoreDuplicates: true });
      if (result.error) throw result.error;
      const loaded = await db.from("accounts").select("id,status").eq("domain", selected.domain).single();
      if (loaded.error) throw loaded.error;
      account = loaded.data;
    }
    if (account.status !== "active") return Response.json({ error: "This account is paused, a client or marked do not contact. Its existing restriction was preserved." }, { status: 409 });
    let personResult = await db.from("people").select("id,full_name,title,email,do_not_contact").eq("account_id", account.id).ilike("full_name", selected.buyer.name).maybeSingle();
    if (personResult.error) throw personResult.error;
    if (!personResult.data) {
      const parts = selected.buyer.name.trim().split(/\s+/);
      const inserted = await db.from("people").insert({ account_id: account.id, full_name: selected.buyer.name, first_name: parts[0], last_name: parts.slice(1).join(" "), title: selected.buyer.title, level: "owner", email_status: "none" });
      // A concurrent request may have created the same person under the unique name/account index.
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      personResult = await db.from("people").select("id,full_name,title,email,do_not_contact").eq("account_id", account.id).ilike("full_name", selected.buyer.name).single();
      if (personResult.error) throw personResult.error;
    }
    const person = personResult.data;
    if (!person || person.do_not_contact) return Response.json({ error: "This person is marked do not contact." }, { status: 409 });
    const touches = await db.from("touches").select("id", { count: "exact", head: true }).eq("person_id", person.id);
    if (touches.error) throw touches.error;
    if (touches.count) return Response.json({ error: "Outreach is already recorded for this person. Continue from History or Follow-ups." }, { status: 409 });
    const hash = `operator-shortlist-20260923:${selected.domain}`;
    const signalWrite = await db.from("signals").upsert({ account_id: account.id, person_id: person.id, type: "other", summary: selected.trigger.fact, source_url: selected.trigger.sourceUrl, source_domain: new URL(selected.trigger.sourceUrl).hostname, observed_at: selected.researchDate, hash, strength: 0, raw: { operating_need: selected.hypothesis, research_date: selected.researchDate, source_date: selected.trigger.date, curated: true } }, { onConflict: "account_id,hash", ignoreDuplicates: true });
    if (signalWrite.error) throw signalWrite.error;
    const signal = await db.from("signals").select("id").eq("account_id", account.id).eq("hash", hash).single();
    if (signal.error) throw signal.error;
    const profile = await senderProfile(db, me.owner);
    const draft = composeContactDraft({ company: selected.company, domain: selected.domain, personName: person.full_name, personTitle: selected.buyer.title, senderName: profile.fromName, senderTitle: profile.title, greeting: profile.greeting, signoff: profile.signoff, intro: profile.intro });
    const saved = await db.from("cards").upsert({ signal_id: signal.data.id, account_id: account.id, person_id: person.id, score: 0, score_breakdown: {}, brief: selected.fit, why_now: selected.trigger.fact, channel: "email_first", email_subject: draft.subject, email_body: draft.body, assigned_to: me.owner, status: "new" }, { onConflict: "signal_id,person_id", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
    const card = await db.from("cards").select("id").eq("signal_id", signal.data.id).eq("person_id", person.id).single();
    if (card.error) throw card.error;
    return Response.json({ id: card.data.id });
}
