import { Header } from "./Header";

/**
 * Shown the instant a navigation starts, while the destination renders on the
 * server. Keeps the sidebar in place and shimmers a few placeholder rows so
 * clicking between pages feels immediate instead of blank-and-waiting.
 */
export function LoadingShell({ rows = 6 }: { rows?: number }) {
  return (
    <div className="shell">
      <Header />
      <main className="loading-main" aria-busy="true" aria-label="Loading">
        <div className="skeleton-head" />
        {Array.from({ length: rows }).map((_, index) => <div key={index} className="skeleton-row" />)}
      </main>
    </div>
  );
}
