import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CSSProperties } from "react";

/**
 * The one hero image, used on the Today page, the login screen and every
 * page head. Drop the file in public/ as night-watch-hero.jpg (or .png /
 * .webp); until it is there the earlier nightscape stays so nothing breaks.
 */
const CANDIDATES = ["night-watch-hero.jpg", "night-watch-hero.jpeg", "night-watch-hero.png", "night-watch-hero.webp"];
const FALLBACK = "/night-watch-los-angeles.png";

function resolveHero() {
  for (const file of CANDIDATES) if (existsSync(join(process.cwd(), "public", file))) return `/${file}`;
  return FALLBACK;
}

export const HERO_IMAGE = resolveHero();
export const HERO_IS_CUSTOM = HERO_IMAGE !== FALLBACK;
export const HERO_ALT = HERO_IS_CUSTOM ? "A figure walking through a night city toward a glowing clock face" : "Los Angeles glowing at night beneath a charcoal sky";

/** Inline style carrying the image as a CSS variable, for page heads and the login screen. */
export const heroStyle = { "--hero": `url(${HERO_IMAGE})` } as CSSProperties;
