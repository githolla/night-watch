import { requireUser } from '@/lib/auth';
import { admin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/gmail';
import { senderProfile, fromHeader, sanitizeLinks } from '@/lib/sender';
import { withOutreachName, outreachEmailHtml } from '@/lib/outreach-ending';
import { trackedEmailHtml, firstOpenAt } from '@/lib/open-tracking';
import { trackEmailVersion } from '@/lib/version-tracking';
import { versionLabel, SAVED_VERSION_MODEL } from '@/lib/version-attribution';
import { outboundBaseUrl } from '@/lib/urls';
import { z } from 'zod';

export const maxDuration = 60;
const input = z.object({ subject: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(1000) });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const payload = input.parse(await request.json());
    const db = admin();
    // Recipient is resolved server-side. No prospect address or saved CCs are ever used.
    const { data: connection } = await db.from('gmail_connections').select('email').eq('owner', user.owner).maybeSingle();
    if (!connection?.email) return Response.json({ error: 'Connect your Gmail in Settings first, then retry this test.' }, { status: 400 });
    const { count, error: capError } = await db.from('message_experiments').select('id', { count: 'exact', head: true }).eq('owner', user.owner).eq('model', SAVED_VERSION_MODEL).eq('goal', 'Email tracking self-test').gte('created_at', new Date(Date.now() - 600000).toISOString());
    if (capError) throw capError;
    if ((count ?? 0) >= 5) return Response.json({ error: 'Five tests have been requested in the last ten minutes. Wait a few minutes before sending another.' }, { status: 429 });
    const { data: card, error: cardError } = await db.from('cards').select('person_id').eq('id', id).single();
    if (cardError || !card) throw new Error('This draft is no longer available.');
    const profile = await senderProfile(db, user.owner);
    const body = sanitizeLinks(payload.body);
    const fullBody = withOutreachName(body, profile);
    const versionId = await trackEmailVersion(db, { cardId: id, personId: card.person_id, owner: user.owner, subject: payload.subject, body: fullBody, source: 'test' });
    const html = trackedEmailHtml(outreachEmailHtml(body, profile), outboundBaseUrl(request), versionId);
    await sendEmail(user.owner, fromHeader(profile, connection.email), connection.email, `[Night Watch test] ${payload.subject}`, fullBody, undefined, [], html);
    // Tests never create touches, change card status or enroll follow-ups.
    const { data: snapshot } = await db.from('message_variants').select('experiment_id,dimensions').eq('id', versionId).single();
    let warning: string | undefined;
    if (snapshot) {
      const { error } = await db.from('message_experiments').update({ status: 'sent' }).eq('id', snapshot.experiment_id).eq('owner', user.owner);
      if (error) warning = 'The test was sent, but its delivery status could not be saved. Do not resend just to fix that.';
    } else warning = 'The test was sent, but its history could not be loaded.';
    return Response.json({ ok: true, id: versionId, to: connection.email, label: versionLabel(snapshot?.dimensions), openAt: null, warning });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Test send failed' }, { status: 400 }); }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const testId = new URL(request.url).searchParams.get('testId');
    const db = admin();
    let query = db.from('message_variants').select('id,created_at,subject,dimensions,message_experiments!inner(owner,card_id,status,context)').eq('dimensions->>source', 'test').eq('message_experiments.owner', user.owner).eq('message_experiments.card_id', id).order('created_at', { ascending: false }).limit(1);
    if (testId) query = query.eq('id', z.string().uuid().parse(testId));
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ test: null });
    const experiment = data.message_experiments as unknown as { status: string; context: string };
    return Response.json({ test: { id: data.id, label: versionLabel(data.dimensions), subject: data.subject, at: data.created_at, status: experiment.status, openAt: firstOpenAt(experiment.context) } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not check test status' }, { status: 400 }); }
}
