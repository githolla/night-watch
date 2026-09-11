"use client";

/**
 * Production redacts server-side error messages (React error #441 is the
 * redaction itself). The digest is the only handle on the real error, so
 * show it and say where to look it up.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const redacted = /Server Components render|#441/.test(error.message);
  return (
    <main className="login">
      <div className="login-card">
        <div className="eyebrow">Night Watch</div>
        <h1>Something went wrong.</h1>
        <p className="notice">
          {redacted
            ? "A server-side query failed while building this page. Production hides the message; the digest below finds it in the Vercel function logs. If a migration was just added, the page shows which one is missing once the database can be reached."
            : error.message}
        </p>
        {error.digest && <p className="run-panel-estimate">DIGEST {error.digest}</p>}
        <button className="btn primary" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
