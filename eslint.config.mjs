// eslint.config.mjs
//
// Mirrors the ruleset community.obsidian.md's automated plugin review runs
// (eslint-plugin-obsidianmd's `recommended` config: ESLint core +
// typescript-eslint type-checked rules + Obsidian-specific rules like
// obsidianmd/prefer-create-el and obsidianmd/no-unsupported-api). Running
// `npm run lint` locally catches the same issues the remote review would,
// before pushing — instead of finding out from the review page afterward.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "coverage/**"],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // tsconfig.json only lists `src/**/*.ts`; this lets ESLint type-check
          // files outside that (tests, this config file, esbuild.config.mjs)
          // using a synthesized default project instead of erroring on them.
          allowDefaultProject: [
            "eslint.config.mjs",
            "esbuild.config.mjs",
            "tests/*.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Test files aren't part of the shipped plugin — Obsidian-specific rules
    // (createEl preference, unsupported-API checks) don't apply to them.
    files: ["tests/**/*.ts"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/no-unsupported-api": "off",
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      // IMDb/TMDb are third-party brand names with fixed internal casing,
      // not sentence-case violations — preserve them as-is.
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          ignoreWords: ["IMDb", "TMDb", "English", "non-English"],
          // These two setting descriptions embed a real lowercase URL path
          // (themoviedb.org/settings/api) and literal ISO country-code
          // examples (US/GB/DE) — the rule's prose-casing heuristic would
          // otherwise "fix" them into incorrect values, not fix a real typo.
          ignoreRegex: ["^Used to fetch season episode lists", "^Country code for streaming availability"],
        },
      ],
    },
  },
]);
