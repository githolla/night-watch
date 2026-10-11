"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { logoDomain } from "@/lib/logo-domain";

const initials = (name: string) => name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "?";

/**
 * The company's logo, or its initials when no logo was found, linking to the company's website in a new tab.
 * Inside a button or another link (`nested`), it opens the site itself instead of nesting a link, and the
 * click never reaches the row around it.
 */
export function CompanyLogo({ domain, name, size = 36, className = "", nested = false }: { domain: string | null | undefined; name: string; size?: number; className?: string; nested?: boolean }) {
  const [failed, setFailed] = useState(false);
  const site = logoDomain(domain);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  const face = site && !failed
    // eslint-disable-next-line @next/next/no-img-element -- small cached icons from our own route; next/image adds nothing here
    ? <img src={`/api/logo?domain=${encodeURIComponent(site)}`} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
    : initials(name);
  const classes = `co-logo ${site && !failed ? "" : "is-initials"} ${site ? "is-link" : ""} ${className}`;
  if (!site) return <span className={classes} style={style} aria-hidden="true">{face}</span>;

  const href = `https://${site}`;
  const label = `Open ${name || site}'s website`;
  if (!nested) {
    return <a className={classes} style={style} href={href} target="_blank" rel="noopener noreferrer" title={site} aria-label={label} onClick={(event) => event.stopPropagation()}>{face}</a>;
  }
  const open = (event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.open(href, "_blank", "noopener,noreferrer");
  };
  return (
    <span className={classes} style={style} role="link" tabIndex={0} title={site} aria-label={label} onClick={open}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") open(event); }}>
      {face}
    </span>
  );
}
