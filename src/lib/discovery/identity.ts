import { createHash } from "node:crypto";
import { normalizeUrl } from "../evidence-grounding.ts";
import type { DiscoveryItem } from "./domain.ts";
export function itemId(item: DiscoveryItem) { return createHash("sha256").update(`${normalizeUrl(item.url)}${item.provider === "company_site" ? `:${item.external_id}` : ""}`).digest("hex"); }
