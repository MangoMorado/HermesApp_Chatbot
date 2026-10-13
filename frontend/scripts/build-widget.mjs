import { stat } from "node:fs/promises";
import { build } from "esbuild";

/**
 * Empaqueta el widget del chat en un único archivo autocontenido (React incluido) para
 * pegarlo en sitios de terceros. Se ejecuta desde `frontend/`.
 */
const outfile = "public/widget.js";

await build({
  entryPoints: ["src/widget/embed.tsx"],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  // Las directivas "use client" de los módulos compartidos con Next no aplican aquí.
  logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"' },
});

const { size } = await stat(outfile);
process.stdout.write(`widget.js generado (${Math.round(size / 1024)} KB)\n`);
