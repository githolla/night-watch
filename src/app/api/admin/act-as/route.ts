import { requireActualUser } from '@/lib/auth';
import { admin } from '@/lib/supabase/admin';
import { ACTING_COOKIE, issueActingSession } from '@/lib/acting-session';
import { NextResponse } from 'next/server';
export async function POST(request: Request) {
  try {
    const actor = await requireActualUser();
    if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Same-origin request required.' }, { status: 403 });
    const { stop } = await request.json();
    let token = '';
    if (!stop) {
      if (actor.role !== "admin") throw new Error("Admins only");
      const { data, error } = await admin().from('app_users').select('id,name,email,owner').eq('owner', 'jenna');
      if (error) throw new Error('Could not load Suuchi’s account.');
      const named = (data ?? []).filter(user => /suuchi/i.test(user.name));
      const candidates = named.length ? named : data ?? [];
      if (candidates.length !== 1) throw new Error('Suuchi’s account could not be uniquely identified. Check Team settings.');
      token = issueActingSession(actor.id, candidates[0].id);
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACTING_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: stop ? 0 : 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Account switch failed.' }, { status: 403 });
  }
}
