/** Hand edits and approvals are decisions. Automated copy refresh must not undo them. */
export function shouldRefreshDraft(status: string, hasAuthoredCopy: boolean, hasBlockingFault: boolean, alreadyContacted = false) {
  return status === "new" && !alreadyContacted && (hasAuthoredCopy || hasBlockingFault);
}
export function preservesCurrentDraft(current: { status: string; email_subject: string | null; email_body: string | null }, original: { status: string; email_subject: string | null; email_body: string | null }) {
  return current.status === original.status && current.email_subject === original.email_subject && current.email_body === original.email_body;
}
