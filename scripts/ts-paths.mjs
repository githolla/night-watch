// Lets plain Node run app modules from scripts: maps the "@/" path alias to src/ and lets extensionless
// relative imports find their .ts file, the way Next and TypeScript resolve them.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = new URL("../src/", import.meta.url);
const candidates = (path) => [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`];

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) base = fileURLToPath(new URL(specifier.slice(2), src));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) base = fileURLToPath(new URL(specifier, context.parentURL));
    if (base) {
      const found = candidates(base).find((path) => existsSync(path) && !path.endsWith("/"));
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
    return nextResolve(specifier, context);
  },
});
