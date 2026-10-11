"use client";

import Link from "next/link";

/**
 * Production redacts server-side error messages (React error #441 is the
 * redaction itself). The digest is the only handle on the real error, so
 * keep it, folded away, for whoever looks it up in the Vercel function logs.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const redacted = /Server Components render|#441/.test(error.message);
  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell error-page">
        <h1>This page did not load.</h1>
        <p>Nothing was lost. Try again, or go back to Home. If it keeps happening, let Josh know.</p>
        <div className="as-controls">
          <button type="button" className="btn primary" onClick={reset}>Try again</button>
          <Link className="btn" href="/">Go to Home</Link>
        </div>
        <details className="error-details">
          <summary>Details for Josh</summary>
          <p>{redacted ? "A server-side query failed while building this page. Production hides the message; the digest below finds it in the Vercel function logs. If a migration was just added, the page shows which one is missing once the database can be reached." : error.message}</p>
          {error.digest && <p>Digest: <code>{error.digest}</code></p>}
        </details>
      </div>
    </main>
  );
}
