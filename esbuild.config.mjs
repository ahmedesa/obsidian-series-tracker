import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";

// Deterministic banner (version, not a wall-clock timestamp) so two builds
// from the same source always produce byte-identical output — a build-time
// timestamp made every fresh rebuild diverge from the CI-built release
// artifact, permanently tripping community.obsidian.md's "build output
// does not match the released artifact" check.
const { version } = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url)));
const banner = `/* series-tracker v${version} */`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
