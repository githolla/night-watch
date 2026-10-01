/** Real links keep owner and batch changes usable without client-side routing. */
import type { ListSequence } from "@/lib/focus-data";

const batchParam = (sequence: ListSequence) => sequence === 3 ? 'today' : String(sequence);
const batchLabel = (sequence: ListSequence, todayCount: number) => sequence === 3 ? `Today's ${todayCount}` : sequence === 1 ? 'First 25' : 'Next 25';

export function ReachoutListNavigation({ owner, batch, todayCount = 0 }: { owner: 'josh' | 'suuchi'; batch: ListSequence; todayCount?: number }) {
  const sequences: ListSequence[] = todayCount > 0 ? [3, 1, 2] : [1, 2];
  return <div className="reachout-navigation">
    <div className="reachout-navigation-group">
      <span className="reachout-navigation-label">List owner</span>
      <nav aria-label="Reach-out lists" className="reachout-segments">
        {(['josh', 'suuchi'] as const).map(id => <a key={id}
          href={`/outreach?list=${id}&batch=${batchParam(batch)}`}
          aria-current={owner === id ? 'page' : undefined}>
          <span className="reachout-owner-avatar" aria-hidden="true">{id === 'josh' ? 'J' : 'S'}</span>
          {id === 'josh' ? 'Josh' : 'Suuchi'}
        </a>)}
      </nav>
    </div>
    <div className="reachout-navigation-group">
      <span className="reachout-navigation-label">Companies</span>
      <nav aria-label="Company batches" className="reachout-segments">
        {sequences.map(sequence => <a key={sequence}
          href={`/outreach?list=${owner}&batch=${batchParam(sequence)}`}
          aria-current={batch === sequence ? 'page' : undefined}>
          {batchLabel(sequence, todayCount)}
        </a>)}
      </nav>
    </div>
  </div>;
}
