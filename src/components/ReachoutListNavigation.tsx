/** Real links keep owner and batch changes usable without client-side routing. */
export function ReachoutListNavigation({ owner, batch }: { owner: 'josh' | 'suuchi'; batch: 1 | 2 }) {
  return <div className="reachout-navigation">
    <div className="reachout-navigation-group">
      <span className="reachout-navigation-label">List owner</span>
      <nav aria-label="Reach-out lists" className="reachout-segments">
        {(['josh', 'suuchi'] as const).map(id => <a key={id}
          href={`/outreach?list=${id}&batch=${batch}`}
          aria-current={owner === id ? 'page' : undefined}>
          <span className="reachout-owner-avatar" aria-hidden="true">{id === 'josh' ? 'J' : 'S'}</span>
          {id === 'josh' ? 'Josh' : 'Suuchi'}
        </a>)}
      </nav>
    </div>
    <div className="reachout-navigation-group">
      <span className="reachout-navigation-label">Companies</span>
      <nav aria-label="Company batches" className="reachout-segments">
        {([1, 2] as const).map(sequence => <a key={sequence}
          href={`/outreach?list=${owner}&batch=${sequence}`}
          aria-current={batch === sequence ? 'page' : undefined}>
          {sequence === 1 ? 'First 25' : 'Next 25'}
        </a>)}
      </nav>
    </div>
  </div>;
}
