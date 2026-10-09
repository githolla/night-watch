"use client";

import { useState } from "react";

/** Copy the brief as plain text (for notes or a calendar invite), or print it. */
export function BriefActions({ text }: { text: string }) {
  const [copied, setCopied] = useState<"" | "ok" | "failed">("");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied("ok"); }
    catch { setCopied("failed"); }
    window.setTimeout(() => setCopied(""), 2500);
  }
  return (
    <span className="brief-actions">
      <button type="button" className="btn" onClick={() => void copy()}>{copied === "ok" ? "Copied" : copied === "failed" ? "Could not copy" : "Copy brief"}</button>
      <button type="button" className="btn ghost" onClick={() => window.print()}>Print</button>
    </span>
  );
}
