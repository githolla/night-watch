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
            <h1>{pending.length === 1 ? "One migration" : `${pending.length} migrations`} to apply before this page can load.</h1>
            <p>The deploy is newer than the database. Open the Supabase SQL editor, paste each file below in order, and run it. Then reload.</p>
          </div>
        </section>
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
      </main>
    </div>
  );
}
