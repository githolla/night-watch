import { CopyButton } from "./CopyButton";
import { Header } from "./Header";
import type { PendingMigration } from "@/lib/schema-check";

/** Shown instead of a page when the database has not applied a migration the code needs. */
export function MigrationRequired({ pending }: { pending: PendingMigration[] }) {
  return (
    <div className="shell">
      <Header />
      <main className="targets-page">
        <section className="targets-head has-hero">
          <div>
            <span className="eyebrow">Database behind the code</span>
            <h1>One paste in Supabase, then this page works.</h1>
            <p>The deploy is newer than the database. Copy the SQL below, open your Supabase project → <strong>SQL Editor</strong> → <strong>New query</strong>, paste, press <strong>Run</strong>, and come back here. Nothing else to configure.</p>
          </div>
        </section>
        <section className="migration-sql">
          <header><div><span className="eyebrow">Step 1 of 1</span><h2>Copy this, run it in the Supabase SQL editor, reload</h2></div><CopyButton text={pending.map((item) => `-- ${item.file}\n${item.sql}`).join("\n\n")} label="Copy the SQL" /></header>
          <textarea readOnly value={pending.map((item) => `-- ${item.file}\n${item.sql}`).join("\n\n")} rows={16} />
        </section>
        <details className="account-more migration-detail">
          <summary>What the database said</summary>
        <div className="run-log-wrap">
          <table className="run-log">
            <thead><tr><th>#</th><th>File</th><th>Adds</th><th>What the database said</th></tr></thead>
            <tbody>
              {pending.map((item, index) => (
                <tr key={item.file} className="is-error">
                  <td className="run-log-index">{String(index + 1).padStart(2, "0")}</td>
                  <td><strong>supabase/migrations/{item.file}</strong></td>
                  <td>{item.adds}</td>
                  <td className="run-log-outcome"><pre>{item.reason}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </details>
      </main>
    </div>
  );
}
