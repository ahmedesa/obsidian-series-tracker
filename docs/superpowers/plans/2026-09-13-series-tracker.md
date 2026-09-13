# Series Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Obsidian plugin that renders a TrackSeries-style dashboard (stat tiles + poster grid) and a per-show episode-checklist detail view, reading/writing the existing `Media/Series/*.md` notes in the SecondBrain vault.

**Architecture:** Single Obsidian `ItemView` registered by a standard TypeScript plugin (esbuild → `main.js`). No separate data store — parses frontmatter + `## Season N` headings + `- [ ]` episode lines directly from the vault's markdown files, and writes checkbox toggles back into those same files. OMDb calls are cached in plugin data with a 24h TTL.

**Tech Stack:** TypeScript, esbuild, Obsidian Plugin API, vitest (unit tests for pure logic), OMDb API.

**Spec:** `docs/superpowers/specs/2026-09-13-series-tracker-design.md`

## Global Constraints
- `isDesktopOnly: false` in manifest.json — must work on mobile.
- No Node-only APIs (`fs`, `path`, `electron` internals) — only `obsidian` module APIs and standard `fetch`.
- OMDb only for v1 (no TMDB).
- No community-plugin submission in this plan — local install only.
- Minimum Obsidian version: `1.7.0` (Bases-era, matches the rest of the vault).

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `manifest.json`
- Create: `versions.json`
- Create: `src/main.ts` (stub)

**Interfaces:**
- Produces: a `src/main.ts` entry point that `esbuild.config.mjs` bundles to `main.js`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "series-tracker",
  "version": "0.1.0",
  "description": "Dashboard and episode tracker for TV series notes in Obsidian.",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.20.0",
    "obsidian": "^1.5.7",
    "tslib": "^2.6.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strict": true,
    "lib": ["DOM", "ES6", "ES7"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write esbuild.config.mjs**

```js
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/* series-tracker: built ${new Date().toISOString()} */`;

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
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeshake: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

- [ ] **Step 4: Write manifest.json**

```json
{
  "id": "series-tracker",
  "name": "Series Tracker",
  "version": "0.1.0",
  "minAppVersion": "1.7.0",
  "description": "Dashboard and episode tracker for TV series notes.",
  "author": "Ahmed Essa",
  "isDesktopOnly": false
}
```

- [ ] **Step 5: Write versions.json**

```json
{
  "0.1.0": "1.7.0"
}
```

- [ ] **Step 6: Write stub src/main.ts**

```ts
import { Plugin } from "obsidian";

export default class SeriesTrackerPlugin extends Plugin {
  async onload() {
    console.log("Series Tracker: loaded");
  }
}
```

- [ ] **Step 7: Install dependencies and verify build**

Run: `npm install && npm run build`
Expected: `main.js` is created in the project root with no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json esbuild.config.mjs manifest.json versions.json src/main.ts package-lock.json
git commit -m "chore: scaffold Series Tracker Obsidian plugin project"
```

---

### Task 2: SeriesParser — parse series notes into structured data

**Files:**
- Create: `src/SeriesParser.ts`
- Test: `tests/SeriesParser.test.ts`

**Interfaces:**
- Produces: `Episode`, `Season`, `SeriesFrontmatter`, `ParsedSeries` types; `parseSeriesBody(body: string): Season[]`; `parseFrontmatter(fm: Record<string, any>): SeriesFrontmatter`; `extractImdbId(sourceUrl: string): string | null`; `toggleEpisodeLine(bodyLines: string[], lineIndex: number, watched: boolean): string[]`.
- Consumed by: Task 5 (DashboardView), Task 6 (ShowDetailView).

- [ ] **Step 1: Write the failing tests**

Create `tests/SeriesParser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSeriesBody, parseFrontmatter, extractImdbId, toggleEpisodeLine } from "../src/SeriesParser";

describe("parseSeriesBody", () => {
  it("parses seasons and episodes with watched state", () => {
    const body = [
      "## Season 1",
      "- [x] E1 — Refined Aggression",
      "- [ ] E2 — Tackle Tommy Woo Woo",
      "",
      "## Season 2",
      "- [ ] E1 — The Road to Kingdom",
    ].join("\n");

    const seasons = parseSeriesBody(body);

    expect(seasons).toHaveLength(2);
    expect(seasons[0].number).toBe(1);
    expect(seasons[0].episodes).toHaveLength(2);
    expect(seasons[0].episodes[0]).toMatchObject({ number: 1, title: "Refined Aggression", watched: true });
    expect(seasons[0].episodes[1]).toMatchObject({ number: 2, title: "Tackle Tommy Woo Woo", watched: false });
    expect(seasons[1].episodes[0]).toMatchObject({ number: 1, title: "The Road to Kingdom", watched: false });
  });

  it("ignores lines outside a season heading", () => {
    const body = "- [ ] E1 — orphan episode\n## Season 1\n- [ ] E1 — real episode";
    const seasons = parseSeriesBody(body);
    expect(seasons).toHaveLength(1);
    expect(seasons[0].episodes).toHaveLength(1);
    expect(seasons[0].episodes[0].title).toBe("real episode");
  });
});

describe("parseFrontmatter", () => {
  it("fills defaults for missing fields", () => {
    const fm = parseFrontmatter({ title: "The Gentlemen" });
    expect(fm).toMatchObject({
      title: "The Gentlemen",
      status: "want-to-watch",
      rating: null,
      image: "",
      source_url: "",
    });
  });
});

describe("extractImdbId", () => {
  it("extracts an IMDb id from a title URL", () => {
    expect(extractImdbId("https://www.imdb.com/title/tt13210838/")).toBe("tt13210838");
  });

  it("returns null for a non-IMDb url", () => {
    expect(extractImdbId("https://example.com")).toBeNull();
  });
});

describe("toggleEpisodeLine", () => {
  it("checks an unchecked line", () => {
    const lines = ["- [ ] E1 — Pilot"];
    const result = toggleEpisodeLine(lines, 0, true);
    expect(result[0]).toBe("- [x] E1 — Pilot");
  });

  it("unchecks a checked line", () => {
    const lines = ["- [x] E1 — Pilot"];
    const result = toggleEpisodeLine(lines, 0, false);
    expect(result[0]).toBe("- [ ] E1 — Pilot");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/SeriesParser.test.ts`
Expected: FAIL — `src/SeriesParser.ts` does not exist yet.

- [ ] **Step 3: Write src/SeriesParser.ts**

```ts
export interface Episode {
  number: number;
  title: string;
  watched: boolean;
  lineIndex: number;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface SeriesFrontmatter {
  title: string;
  status: string;
  rating: number | null;
  image: string;
  source_url: string;
}

export interface ParsedSeries {
  frontmatter: SeriesFrontmatter;
  seasons: Season[];
  filePath: string;
}

const SEASON_HEADING_RE = /^##\s+Season\s+(\d+)\s*$/;
const EPISODE_LINE_RE = /^-\s+\[( |x|X)\]\s+E(\d+)\s*(?:—|-)?\s*(.*)$/;

export function parseSeriesBody(body: string): Season[] {
  const lines = body.split("\n");
  const seasons: Season[] = [];
  let current: Season | null = null;

  lines.forEach((line, idx) => {
    const seasonMatch = line.match(SEASON_HEADING_RE);
    if (seasonMatch) {
      current = { number: parseInt(seasonMatch[1], 10), episodes: [] };
      seasons.push(current);
      return;
    }
    const epMatch = line.match(EPISODE_LINE_RE);
    if (epMatch && current) {
      current.episodes.push({
        number: parseInt(epMatch[2], 10),
        title: epMatch[3].trim(),
        watched: epMatch[1].toLowerCase() === "x",
        lineIndex: idx,
      });
    }
  });

  return seasons;
}

export function parseFrontmatter(fm: Record<string, any>): SeriesFrontmatter {
  return {
    title: fm.title ?? "",
    status: fm.status ?? "want-to-watch",
    rating: typeof fm.rating === "number" ? fm.rating : null,
    image: fm.image ?? "",
    source_url: fm.source_url ?? "",
  };
}

export function extractImdbId(sourceUrl: string): string | null {
  const m = sourceUrl.match(/title\/(tt\d+)/);
  return m ? m[1] : null;
}

export function toggleEpisodeLine(bodyLines: string[], lineIndex: number, watched: boolean): string[] {
  const out = [...bodyLines];
  const line = out[lineIndex];
  if (!line) return out;
  out[lineIndex] = watched
    ? line.replace(/^-\s+\[ \]/, "- [x]")
    : line.replace(/^-\s+\[[xX]\]/, "- [ ]");
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/SeriesParser.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/SeriesParser.ts tests/SeriesParser.test.ts
git commit -m "feat: add SeriesParser for parsing series notes into structured data"
```

---

### Task 3: OmdbClient — cached OMDb season fetcher

**Files:**
- Create: `src/OmdbClient.ts`
- Test: `tests/OmdbClient.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `OmdbEpisode`, `OmdbSeasonResponse` types; `class OmdbClient` with constructor `(apiKey: string, cache: Record<string, {fetchedAt: number; data: OmdbSeasonResponse}>, saveCache: (cache) => Promise<void>)` and method `getSeason(imdbId: string, season: number): Promise<OmdbSeasonResponse | null>`.
- Consumed by: Task 6 (ShowDetailView).

- [ ] **Step 1: Write the failing tests**

Create `tests/OmdbClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OmdbClient } from "../src/OmdbClient";

describe("OmdbClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and caches a season", async () => {
    const mockResponse = {
      Response: "True",
      Episodes: [
        { Title: "Refined Aggression", Episode: "1", Released: "2024-03-07", imdbRating: "8.2" },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({ json: async () => mockResponse }) as any;

    const cache: Record<string, any> = {};
    const saveCache = vi.fn(async (c: any) => { Object.assign(cache, c); });
    const client = new OmdbClient("fake-key", cache, saveCache);

    const result = await client.getSeason("tt13210838", 1);

    expect(result).not.toBeNull();
    expect(result!.episodes[0]).toMatchObject({ title: "Refined Aggression", episode: 1 });
    expect(saveCache).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses cache instead of refetching within TTL", async () => {
    global.fetch = vi.fn() as any;
    const cache = {
      "tt123:1": { fetchedAt: Date.now(), data: { season: 1, episodes: [] } },
    };
    const client = new OmdbClient("fake-key", cache, vi.fn());

    const result = await client.getSeason("tt123", 1);

    expect(result).toEqual({ season: 1, episodes: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null with no key and no cache", async () => {
    global.fetch = vi.fn() as any;
    const client = new OmdbClient("", {}, vi.fn());
    const result = await client.getSeason("tt123", 1);
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/OmdbClient.test.ts`
Expected: FAIL — `src/OmdbClient.ts` does not exist yet.

- [ ] **Step 3: Write src/OmdbClient.ts**

```ts
export interface OmdbEpisode {
  title: string;
  episode: number;
  released: string;
  imdbRating: string;
}

export interface OmdbSeasonResponse {
  season: number;
  episodes: OmdbEpisode[];
}

interface CacheEntry {
  fetchedAt: number;
  data: OmdbSeasonResponse;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class OmdbClient {
  constructor(
    private apiKey: string,
    private cache: Record<string, CacheEntry>,
    private saveCache: (cache: Record<string, CacheEntry>) => Promise<void>,
  ) {}

  private cacheKey(imdbId: string, season: number): string {
    return `${imdbId}:${season}`;
  }

  async getSeason(imdbId: string, season: number): Promise<OmdbSeasonResponse | null> {
    const key = this.cacheKey(imdbId, season);
    const cached = this.cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data;
    }
    if (!this.apiKey) return cached?.data ?? null;

    try {
      const url = `https://www.omdbapi.com/?apikey=${this.apiKey}&i=${imdbId}&Season=${season}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.Response !== "True") return cached?.data ?? null;

      const data: OmdbSeasonResponse = {
        season,
        episodes: (json.Episodes ?? []).map((e: any) => ({
          title: e.Title,
          episode: parseInt(e.Episode, 10),
          released: e.Released,
          imdbRating: e.imdbRating,
        })),
      };
      this.cache[key] = { fetchedAt: Date.now(), data };
      await this.saveCache(this.cache);
      return data;
    } catch {
      return cached?.data ?? null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/OmdbClient.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/OmdbClient.ts tests/OmdbClient.test.ts
git commit -m "feat: add OmdbClient with 24h season cache"
```

---

### Task 4: Plugin entry point + settings tab

**Files:**
- Modify: `src/main.ts`
- Create: `src/SettingsTab.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (Task 5 will register the view here).
- Produces: `SeriesTrackerSettings` interface, `DEFAULT_SETTINGS`, `export default class SeriesTrackerPlugin extends Plugin` with public `settings: SeriesTrackerSettings`, `async saveSettings(): Promise<void>`, `async activateView(): Promise<void>`.

- [ ] **Step 1: Rewrite src/main.ts**

```ts
import { Plugin, WorkspaceLeaf } from "obsidian";
import { SeriesTrackerSettingTab } from "./SettingsTab";

export interface SeriesTrackerSettings {
  omdbApiKey: string;
  seriesFolder: string;
  omdbCache: Record<string, { fetchedAt: number; data: any }>;
}

export const DEFAULT_SETTINGS: SeriesTrackerSettings = {
  omdbApiKey: "",
  seriesFolder: "Media/Series",
  omdbCache: {},
};

export const VIEW_TYPE_DASHBOARD = "series-tracker-dashboard";

export default class SeriesTrackerPlugin extends Plugin {
  settings: SeriesTrackerSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("tv", "Open Series Tracker", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-series-tracker",
      name: "Open Series Tracker",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new SeriesTrackerSettingTab(this.app, this));
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

Note: `activateView` will start working once Task 5 calls `this.registerView(...)` — until then it opens an unregistered view type. That's expected; Step 3 of this task verifies only that the plugin loads and the settings tab renders, not that the view opens.

- [ ] **Step 2: Write src/SettingsTab.ts**

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type SeriesTrackerPlugin from "./main";

export class SeriesTrackerSettingTab extends PluginSettingTab {
  plugin: SeriesTrackerPlugin;

  constructor(app: App, plugin: SeriesTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("OMDb API key")
      .setDesc("Used to fetch season episode lists and air dates. Leave blank to use local checkbox data only.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.omdbApiKey)
          .onChange(async (value) => {
            this.plugin.settings.omdbApiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Series folder")
      .setDesc("Vault-relative folder containing your series notes.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.seriesFolder)
          .onChange(async (value) => {
            this.plugin.settings.seriesFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `main.js` rebuilds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/SettingsTab.ts
git commit -m "feat: add plugin entry point with settings tab"
```

---

### Task 5: DashboardView — stats + poster grid

**Files:**
- Create: `src/DashboardView.ts`
- Modify: `src/main.ts:1` (register the view)
- Create: `styles.css`

**Interfaces:**
- Consumes: `parseSeriesBody`, `parseFrontmatter`, `ParsedSeries` from `./SeriesParser` (Task 2); `SeriesTrackerPlugin`, `VIEW_TYPE_DASHBOARD` from `./main` (Task 4).
- Produces: `class DashboardView extends ItemView` with public `async loadAllSeries(): Promise<{file: TFile; parsed: ParsedSeries}[]>` and `async render(): Promise<void>`.
- Consumed by: Task 6 wires `renderShowDetail` into this view's detail branch; Task 4's `main.ts` registers this view type.

- [ ] **Step 1: Write styles.css**

```css
.series-tracker-view {
  padding: 16px;
}
.st-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
}
.st-tile {
  background: var(--background-secondary);
  border-radius: 8px;
  padding: 12px 16px;
  flex: 1;
}
.st-tile-value {
  font-size: 1.5em;
  font-weight: 700;
}
.st-tile-label {
  color: var(--text-muted);
  font-size: 0.85em;
}
.st-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.st-card {
  cursor: pointer;
  background: var(--background-secondary);
  border-radius: 8px;
  overflow: hidden;
}
.st-card img {
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  display: block;
}
.st-card-title {
  font-weight: 600;
  padding: 6px 8px 0;
}
.st-card-progress {
  color: var(--text-muted);
  font-size: 0.85em;
  padding: 0 8px 8px;
}
.st-episode-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.st-badge-pending {
  color: var(--text-warning);
  font-size: 0.8em;
}
```

- [ ] **Step 2: Write src/DashboardView.ts**

```ts
import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { parseSeriesBody, parseFrontmatter, ParsedSeries } from "./SeriesParser";

export const VIEW_TYPE_DASHBOARD = "series-tracker-dashboard";

export class DashboardView extends ItemView {
  plugin: SeriesTrackerPlugin;
  private currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SeriesTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_DASHBOARD;
  }

  getDisplayText() {
    return "Series Tracker";
  }

  getIcon() {
    return "tv";
  }

  async onOpen() {
    await this.render();
  }

  async loadAllSeries(): Promise<{ file: TFile; parsed: ParsedSeries }[]> {
    const folder = this.plugin.settings.seriesFolder;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") && !f.path.includes("/_bases/"));

    const results: { file: TFile; parsed: ParsedSeries }[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || fm.type !== "series") continue;
      const content = await this.app.vault.read(file);
      const body = content.replace(/^---[\s\S]*?---\n?/, "");
      results.push({
        file,
        parsed: {
          frontmatter: parseFrontmatter(fm),
          seasons: parseSeriesBody(body),
          filePath: file.path,
        },
      });
    }
    return results;
  }

  async render() {
    if (this.currentFile) {
      await this.renderDetail(this.currentFile);
    } else {
      await this.renderDashboard();
    }
  }

  async renderDashboard() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const all = await this.loadAllSeries();

    let totalEp = 0;
    let watchedEp = 0;
    let inProgress = 0;
    for (const { parsed } of all) {
      const episodes = parsed.seasons.flatMap((s) => s.episodes);
      const watched = episodes.filter((e) => e.watched).length;
      totalEp += episodes.length;
      watchedEp += watched;
      if (watched > 0 && watched < episodes.length) inProgress++;
    }

    const stats = container.createDiv({ cls: "st-stats" });
    const tile1 = stats.createDiv({ cls: "st-tile" });
    tile1.createDiv({ cls: "st-tile-value", text: `${watchedEp}/${totalEp}` });
    tile1.createDiv({ cls: "st-tile-label", text: "Episodes watched" });

    const tile2 = stats.createDiv({ cls: "st-tile" });
    tile2.createDiv({ cls: "st-tile-value", text: `${inProgress}` });
    tile2.createDiv({ cls: "st-tile-label", text: "Shows in progress" });

    const tile3 = stats.createDiv({ cls: "st-tile" });
    tile3.createDiv({ cls: "st-tile-value", text: `${all.length}` });
    tile3.createDiv({ cls: "st-tile-label", text: "Shows tracked" });

    const grid = container.createDiv({ cls: "st-grid" });
    for (const { file, parsed } of all) {
      const episodes = parsed.seasons.flatMap((s) => s.episodes);
      const watched = episodes.filter((e) => e.watched).length;
      const pct = episodes.length ? Math.round((100 * watched) / episodes.length) : 0;

      const card = grid.createDiv({ cls: "st-card" });
      if (parsed.frontmatter.image) {
        card.createEl("img", { attr: { src: parsed.frontmatter.image } });
      }
      card.createDiv({ cls: "st-card-title", text: parsed.frontmatter.title });
      card.createDiv({ cls: "st-card-progress", text: `${watched}/${episodes.length} (${pct}%)` });
      card.onClickEvent(() => {
        this.currentFile = file;
        this.render();
      });
    }
  }

  async renderDetail(file: TFile) {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const back = container.createEl("button", { text: "← Back to dashboard" });
    back.onClickEvent(() => {
      this.currentFile = null;
      this.render();
    });

    container.createEl("p", { text: `Detail view for ${file.basename} — wired in Task 6.` });
  }

  async onClose() {}
}
```

- [ ] **Step 3: Register the view in src/main.ts**

Add the import at the top of `src/main.ts`:

```ts
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./DashboardView";
```

Add this line inside `onload()`, before `this.addRibbonIcon(...)`:

```ts
this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
```

Remove the now-duplicate `export const VIEW_TYPE_DASHBOARD = "series-tracker-dashboard";` line from `src/main.ts` (it now lives in `DashboardView.ts` and is imported instead).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: `main.js` rebuilds with no TypeScript errors.

- [ ] **Step 5: Manual verification in the vault**

```bash
mkdir -p ~/SecondBrain/.obsidian/plugins/series-tracker
cp main.js manifest.json styles.css ~/SecondBrain/.obsidian/plugins/series-tracker/
```

Add `"series-tracker"` to the array in `~/SecondBrain/.obsidian/community-plugins.json`. Restart Obsidian (Cmd+Q, reopen). Click the new ribbon "tv" icon.

Expected: a tab opens showing stat tiles and a card for each real series note in `Media/Series` (currently just The Gentlemen, 16/16 watched). Screenshot back if it doesn't match.

- [ ] **Step 6: Commit**

```bash
git add src/DashboardView.ts src/main.ts styles.css
git commit -m "feat: add dashboard view with stats and poster grid"
```

---

### Task 6: ShowDetailView — season tabs, episode checklist, air-date badges

**Files:**
- Create: `src/ShowDetailView.ts`
- Modify: `src/DashboardView.ts:renderDetail` (call the real renderer instead of the placeholder)

**Interfaces:**
- Consumes: `parseSeriesBody`, `parseFrontmatter`, `extractImdbId`, `toggleEpisodeLine` from `./SeriesParser` (Task 2); `OmdbClient`, `OmdbSeasonResponse` from `./OmdbClient` (Task 3); `SeriesTrackerPlugin` from `./main` (Task 4).
- Produces: `async function renderShowDetail(container: Element, app: App, plugin: SeriesTrackerPlugin, file: TFile, onChange: () => void): Promise<void>`.

- [ ] **Step 1: Write src/ShowDetailView.ts**

```ts
import { App, TFile } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { parseSeriesBody, parseFrontmatter, extractImdbId, toggleEpisodeLine } from "./SeriesParser";
import { OmdbClient, OmdbSeasonResponse } from "./OmdbClient";

export async function renderShowDetail(
  container: Element,
  app: App,
  plugin: SeriesTrackerPlugin,
  file: TFile,
  onChange: () => void,
): Promise<void> {
  const content = await app.vault.read(file);
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const bodyLines = body.split("\n");

  const cache = app.metadataCache.getFileCache(file);
  const fm = parseFrontmatter(cache?.frontmatter ?? {});
  const seasons = parseSeriesBody(body);

  container.createEl("h2", { text: fm.title });

  const imdbId = extractImdbId(fm.source_url);
  const omdb = new OmdbClient(
    plugin.settings.omdbApiKey,
    plugin.settings.omdbCache,
    async (c) => {
      plugin.settings.omdbCache = c;
      await plugin.saveSettings();
    },
  );

  const seasonData: Record<number, OmdbSeasonResponse | null> = {};
  if (imdbId) {
    for (const season of seasons) {
      seasonData[season.number] = await omdb.getSeason(imdbId, season.number);
    }
  }

  for (const season of seasons) {
    container.createEl("h3", { text: `Season ${season.number}` });
    const list = container.createDiv({ cls: "st-episode-list" });
    const omdbSeason = seasonData[season.number];

    for (const ep of season.episodes) {
      const row = list.createDiv({ cls: "st-episode-row" });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = ep.watched;
      row.createSpan({ text: ` E${ep.number} — ${ep.title}` });

      const omdbEp = omdbSeason?.episodes.find((e) => e.episode === ep.number);
      if (omdbEp && omdbEp.released) {
        const released = new Date(omdbEp.released);
        const aired = !isNaN(released.getTime()) && released.getTime() <= Date.now();
        if (aired && !ep.watched) {
          row.createSpan({ cls: "st-badge-pending", text: " aired, unwatched" });
        }
      }

      checkbox.addEventListener("change", async () => {
        const newLines = toggleEpisodeLine(bodyLines, ep.lineIndex, checkbox.checked);
        const newBody = newLines.join("\n");
        const newContent = fmMatch ? fmMatch[0] + newBody : newBody;
        await app.vault.modify(file, newContent);
        onChange();
      });
    }
  }
}
```

- [ ] **Step 2: Wire it into DashboardView**

In `src/DashboardView.ts`, add the import:

```ts
import { renderShowDetail } from "./ShowDetailView";
```

Replace the body of `renderDetail` (everything after the "back" button is created) — remove:

```ts
container.createEl("p", { text: `Detail view for ${file.basename} — wired in Task 6.` });
```

Replace with:

```ts
await renderShowDetail(container, this.app, this.plugin, file, () => this.render());
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `main.js` rebuilds with no TypeScript errors.

- [ ] **Step 4: Manual verification in the vault**

```bash
cp main.js ~/SecondBrain/.obsidian/plugins/series-tracker/
```

Restart Obsidian, open Series Tracker, click The Gentlemen's card.

Expected: "Season 1" and "Season 2" headings, 8 checked-off episodes each with real titles, no "aired, unwatched" badges (everything's watched). Uncheck one episode, confirm the badge appears if OMDb has an air date in the past for it, and confirm `Media/Series/The Gentlemen.md` on disk actually changed to `- [ ]` for that line.

- [ ] **Step 5: Commit**

```bash
git add src/ShowDetailView.ts src/DashboardView.ts
git commit -m "feat: add show detail view with episode checklist and air-date badges"
```

---

### Task 7: Package for install + end-to-end verification

**Files:**
- Create: `README.md`
- Modify: `~/SecondBrain/.obsidian/community-plugins.json` (outside this repo — vault config)

**Interfaces:**
- Consumes: the fully-built `main.js`, `manifest.json`, `styles.css` from Tasks 1–6.
- Produces: nothing new — this task verifies the whole plugin end-to-end and documents install steps for future reference.

- [ ] **Step 1: Write README.md**

```markdown
# Series Tracker

Obsidian plugin: a TrackSeries-style dashboard and episode checklist for
`Media/Series/*.md` notes in the SecondBrain vault.

## Install (local, not on community plugin store)

1. `npm install && npm run build`
2. Copy `main.js`, `manifest.json`, `styles.css` into
   `<vault>/.obsidian/plugins/series-tracker/`
3. Add `"series-tracker"` to `<vault>/.obsidian/community-plugins.json`
4. Restart Obsidian, enable it in Settings → Community plugins if needed.
5. Set your OMDb API key in Settings → Series Tracker.

## Development

`npm run dev` starts esbuild in watch mode — re-copy `main.js` into the
vault's plugin folder after each change (or symlink it) and reload Obsidian
(Cmd+P → "Reload app without saving") to see changes.
```

- [ ] **Step 2: Full end-to-end manual verification**

Run: `npm run build`

```bash
cp main.js manifest.json styles.css ~/SecondBrain/.obsidian/plugins/series-tracker/
```

Confirm `~/SecondBrain/.obsidian/community-plugins.json` includes `"series-tracker"` (added during Task 5, Step 5 — verify it's still there).

Restart Obsidian. Checklist:
- [ ] Ribbon "tv" icon opens the dashboard
- [ ] Stat tiles show correct totals matching what's in `Media/Series/*.md`
- [ ] Clicking a card opens its detail view with correct season/episode data
- [ ] Checking/unchecking an episode updates the actual `.md` file (spot-check by opening the note in a normal tab)
- [ ] Settings tab shows OMDb key + folder path fields and persists changes across a restart
- [ ] "← Back to dashboard" returns to the grid with updated stats

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add install and verification instructions"
```

---

## Out of scope (per spec)
- Community plugin directory submission.
- TMDB integration.
- In-plugin season/episode creation or editing beyond the watched checkbox.
