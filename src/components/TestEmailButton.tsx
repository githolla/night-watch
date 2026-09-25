'use client';
import { useState } from 'react';
type TestResult = { id: string; label: string; to?: string; openAt: string | null; giftViewAt?: string | null; status?: string; warning?: string };
export function TestEmailButton({ cardId, subject, body, disabled = false }: { cardId: string; subject: string; body: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');
  async function sendTest() {
    if (busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch(`/api/cards/${cardId}/test-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, body }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not send the test.');
      if (!data.ok || !data.id) throw new Error('Test status unknown. Check your inbox and Sent folder before retrying.');
      setResult({ ...data, status: 'sent' });
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
      else if (data.test.status !== 'sent') setError('This test has no confirmed send. Check your inbox and Sent folder before retrying.');
      else setResult(current => ({ ...current, ...data.test }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not check status.'); }
    finally { setBusy(false); }
  }
  return <div className="composer-test">
    <button className="btn composer-test-button" type="button" disabled={busy || disabled || !subject.trim() || !body.trim()} onClick={sendTest}>{busy ? 'Sending test…' : result ? 'Send another test' : 'Send test to myself'}</button>
    {(error || result) && <div className="composer-test-result" role={error ? 'alert' : 'status'}>
      <button className="composer-test-close" type="button" aria-label="Dismiss test result" onClick={() => { setError(''); setResult(null); }}>×</button>
      {error ? <p>{error}</p> : <><strong>Test sent{result?.to ? ` to ${result.to}` : ''}</strong><p>Check your inbox for the version shown here. No prospect was emailed.</p>{result?.warning && <p>{result.warning}</p>}<button type="button" onClick={check} disabled={busy}>Refresh delivery record</button></>}
    </div>}
  </div>;
}
