'use client';
import { useState } from 'react';
type TestResult = { id: string; label: string; to?: string; openAt: string | null; giftViewAt?: string | null; status?: string; warning?: string };
export function TestEmailButton({ cardId, subject, body, disabled = false }: { cardId: string; subject: string; body: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');
  async function sendTest() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/cards/${cardId}/test-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, body }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not send the test.');
      setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the test.'); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/cards/${cardId}/test-email${result ? `?testId=${result.id}` : ''}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not check status.');
      if (!data.test) setError('No test found for your account and this draft. Send one first.');
      else setResult(current => ({ ...current, ...data.test }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not check status.'); }
    finally { setBusy(false); }
  }
  return <section className="email-test-panel" aria-label="Test email">
    <strong>Test this email</strong>
    <p>Send the current draft to your own connected Gmail. No prospect or CC receives it. Tests are excluded from outreach analytics and follow-ups.</p>
    <button type="button" disabled={busy || disabled || !subject.trim() || !body.trim()} onClick={sendTest}>{busy ? 'Working…' : 'Send test to myself'}</button>{' '}
    <button type="button" disabled={busy || disabled} onClick={check}>Check test status</button>
    {error && <p role="alert">{error}</p>}
    {result && <div role="status"><p><strong>TEST · {result.label}</strong>{result.to ? ` · Sent to ${result.to}` : result.status === 'sent' ? ' · Sent' : ' · Delivery status not confirmed'}</p>
      {result.warning && <p>{result.warning}</p>}
      <small>First-email tests have no tracking pixel or Gift link. Check your inbox to confirm delivery and formatting.</small>
    </div>}
  </section>;
}
