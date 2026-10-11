/** A bare company domain we are willing to look up a logo for: letters, digits and hyphens, with a real suffix. No IPs, ports or paths. */
export function logoDomain(raw: string | null | undefined): string | null {
  const domain = (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (domain.length > 253 || !/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,24}$/.test(domain)) return null;
  return domain;
}
