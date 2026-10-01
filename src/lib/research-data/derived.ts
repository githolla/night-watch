import { researchVersion } from "#research-data";

/** A value computed from the research data, rebuilt only when a new slice arrives in the browser. */
export function derived<T>(build: () => T): () => T {
  let at = -1;
  let value: T;
  return () => {
    const current = researchVersion();
    if (current !== at) { value = build(); at = current; }
    return value;
  };
}
