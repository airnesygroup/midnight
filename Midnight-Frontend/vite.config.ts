// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { builtinModules } from "node:module";
import type { Plugin } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const builtins = new Set(builtinModules.filter((m) => !m.startsWith("_")));

/**
 * The hosted server cannot load Node built-ins through runtime require()
 * (used by the MongoDB driver's CommonJS code). Rewrite each
 * __require("node:x") in server chunks into a static import.
 */
function staticNodeBuiltins(): Plugin {
  return {
    name: "static-node-builtins",
    apply: "build",
    applyToEnvironment: (env) => env.name !== "client",
    renderChunk(code) {
      const re = /\b__require\(\s*["'](?:node:)?([a-z_/]+)["']\s*\)/g;
      const found = new Map<string, string>();
      const out = code.replace(re, (m, name: string) => {
        if (!builtins.has(name)) return m;
        let id = found.get(name);
        if (!id) {
          id = `__nodeBuiltin_${name.replace(/[^a-z]/g, "_")}`;
          found.set(name, id);
        }
        return `(${id}.default ?? ${id})`;
      });
      if (!found.size) return null;
      const imports = [...found].map(([name, id]) => `import * as ${id} from "node:${name}";`).join("\n");
      return { code: `${imports}\n${out}`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [staticNodeBuiltins()],
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
