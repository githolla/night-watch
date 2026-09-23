'use client';
import { useState } from 'react';
import Link from 'next/link';
type TestResult = { id: string; label: string; to?: string; openAt: string | null; status?: string; warning?: string };
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
  return <details className="email-test-panel">
    <summary>Test email &amp; tracking</summary>
    <p>Send the current draft to your own connected Gmail. No prospect or CC receives it. Tests are excluded from outreach analytics and follow-ups.</p>
    <button type="button" disabled={busy || disabled || !subject.trim() || !body.trim()} onClick={sendTest}>{busy ? 'Working…' : 'Send test to myself'}</button>{' '}
    <button type="button" disabled={busy || disabled} onClick={check}>Check test status</button>
    <small>Gmail not connected? <Link href="/settings">Connect it in Settings.</Link></small>
    {error && <p role="alert">{error}</p>}
    {result && <div role="status"><p><strong>TEST · {result.label}</strong>{result.to ? ` · Sent to ${result.to}` : result.status === 'sent' ? ' · Sent' : ' · Delivery status not confirmed'}</p>
      {result.warning && <p>{result.warning}</p>}
      <p>{result.openAt ? `Open detected: ${new Date(result.openAt).toLocaleString()}` : 'No open detected yet. Open the [Night Watch test] email, display images, then click Check test status.'}</p>
      <small>Your mail app may load the image automatically, even from Sent. An open signal is not proof of reading. This tests delivery, the recorded version and the tracking pixel.</small>
    </div>}
  </details>;
}
