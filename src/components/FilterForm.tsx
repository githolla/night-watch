"use client";

import type { FormEvent, ReactNode } from "react";

/**
 * A filter bar that applies itself: changing any dropdown submits the form,
 * so there is nothing to press. The search box still submits on Enter or
 * with the button.
 */
export function FilterForm({ action, children }: { action: string; children: ReactNode }) {
  function onChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "SELECT") event.currentTarget.requestSubmit();
  }
  return <form className="target-filters" action={action} onChange={onChange}>{children}</form>;
}
