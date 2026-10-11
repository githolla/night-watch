"use client";

import { useState } from "react";

const initials = (name: string) => name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "?";

/** The company's logo, or its initials when there is no domain or no logo was found. */
export function CompanyLogo({ domain, name, size = 36, className = "" }: { domain: string | null | undefined; name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (!domain || failed) return <span className={`co-logo is-initials ${className}`} style={style} aria-hidden="true">{initials(name)}</span>;
  return (
    <span className={`co-logo ${className}`} style={style} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- small cached icons from our own route; next/image adds nothing here */}
      <img src={`/api/logo?domain=${encodeURIComponent(domain)}`} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}
