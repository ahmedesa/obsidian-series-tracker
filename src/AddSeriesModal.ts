import { App, Modal, Notice, normalizePath } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { createMetadataProvider, MetadataProvider, MetadataSearchResult } from "./MetadataProvider";
import { todayIso } from "./dateUtil";
import { parseImdbId } from "./SeriesParser";

/** Hard cap on seasons fetched at add-time, to bound API calls for long-running shows. */
const MAX_SEASONS_ON_ADD = 25;

/** Modal: search TMDb by title, pick a result, create a series note for it. */
export class AddSeriesModal extends Modal {
  private plugin: SeriesTrackerPlugin;
  private onAdded: () => void;
  private resultsEl!: HTMLElement;
  private preloadedResult?: MetadataSearchResult;

  /**
   * `preloadedResult` skips straight to a single pre-filled result (still
   * requiring the user's own "Add" click to confirm) — used by the
   * recommendations panel so suggesting a title doesn't need to duplicate
   * `createSeriesNote`/re-implement search.
   */
  constructor(app: App, plugin: SeriesTrackerPlugin, onAdded: () => void, preloadedResult?: MetadataSearchResult) {
    super(app);
    this.plugin = plugin;
    this.onAdded = onAdded;
    this.preloadedResult = preloadedResult;
  }

  private newClient(): MetadataProvider {
    return createMetadataProvider(this.plugin.settings, async (c) => {
      this.plugin.settings.tmdbCache = c;
      await this.plugin.saveSettings();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Add series" });

    const searchRow = contentEl.createDiv({ cls: "st-modal-search-row" });
    const input = searchRow.createEl("input", {
      type: "text",
      placeholder: "Show title…",
    });
    const searchBtn = searchRow.createEl("button", { text: "Search" });

    this.resultsEl = contentEl.createDiv({ cls: "st-modal-results" });

    if (this.preloadedResult) {
      this.renderResults([this.preloadedResult], this.newClient());
    }

    const runSearch = async () => {
      const title = input.value.trim();
      if (!title) return;
      this.resultsEl.empty();
      this.resultsEl.createEl("p", { text: "Searching…" });

      const tmdb = this.newClient();
      const results = await tmdb.search(title, "series");
      this.renderResults(results, tmdb);
    };

    searchBtn.addEventListener("click", () => void runSearch());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void runSearch();
    });
    input.focus();

    contentEl.createEl("p", {
      text: "Can't find it by title (e.g. a non-English title)? Add it directly by IMDb ID or URL:",
      cls: "st-modal-id-hint",
    });
    const idRow = contentEl.createDiv({ cls: "st-modal-search-row" });
    const idInput = idRow.createEl("input", {
      type: "text",
      placeholder: "tt1234567 or https://www.imdb.com/title/tt1234567/",
    });
    const idBtn = idRow.createEl("button", { text: "Add by ID" });

    const runIdAdd = async () => {
      const imdbId = parseImdbId(idInput.value);
      if (!imdbId) {
        new Notice("Series Tracker: enter a valid IMDb id or URL (e.g. tt1234567).");
        return;
      }
      idBtn.disabled = true;
      idBtn.textContent = "Adding…";
      const tmdb = this.newClient();
      try {
        const info = await tmdb.getDetailsByExternalId(imdbId);
        if (!info || !info.title) {
          throw new Error(`no series found for ${imdbId}`);
        }
        if (info.type && info.type !== "series") {
          throw new Error(`${imdbId} is a ${info.type}, not a series`);
        }
        const result: MetadataSearchResult = {
          title: info.title,
          year: info.year,
          tmdbId: info.tmdbId,
          poster: info.poster,
          rating: info.imdbRating,
          plot: info.plot,
        };
        idBtn.textContent = "Fetching seasons…";
        await this.createSeriesNote(result, tmdb);
        new Notice(`Added "${result.title}"`);
        this.onAdded();
        this.close();
      } catch (err) {
        idBtn.disabled = false;
        idBtn.textContent = "Add by ID";
        console.error("Series Tracker: failed to add series by ID", err);
        new Notice(`Series Tracker: failed to add series — ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    idBtn.addEventListener("click", () => void runIdAdd());
    idInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void runIdAdd();
    });
  }

  private renderResults(results: MetadataSearchResult[], tmdb: MetadataProvider): void {
    this.resultsEl.empty();
    if (results.length === 0) {
      this.resultsEl.createEl("p", { text: "No results." });
      return;
    }

    for (const r of results) {
      const row = this.resultsEl.createDiv({ cls: "st-modal-result-row" });
      if (r.poster) {
        row.createEl("img", { attr: { src: r.poster } });
      }
      const info = row.createDiv({ cls: "st-modal-result-info" });
      const titleRow = info.createDiv({ cls: "st-modal-result-title-row" });
      titleRow.createEl("span", { text: `${r.title} (${r.year})`, cls: "st-modal-result-title" });
      if (r.rating) {
        titleRow.createEl("span", { text: `★ ${r.rating}`, cls: "st-modal-result-rating" });
      }
      if (r.plot) {
        info.createEl("div", { text: truncate(r.plot, 140), cls: "st-modal-result-plot" });
      }
      const addBtn = row.createEl("button", { text: "Add" });
      const handleAdd = async () => {
        addBtn.disabled = true;
        addBtn.textContent = "Adding…";
        try {
          addBtn.textContent = "Fetching seasons…";
          await this.createSeriesNote(r, tmdb);
          new Notice(`Added "${r.title}"`);
          this.onAdded();
          this.close();
        } catch (err) {
          addBtn.disabled = false;
          addBtn.textContent = "Add";
          console.error("Series Tracker: failed to add series", err);
          new Notice(`Series Tracker: failed to add series — ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      addBtn.addEventListener("click", () => void handleAdd());
    }
  }

  private async createSeriesNote(result: MetadataSearchResult, tmdb: MetadataProvider): Promise<void> {
    const folder = this.plugin.settings.seriesFolder;
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }

    const info = await tmdb.getDetails(result.tmdbId, "series");
    const genres = info?.genre
      ? info.genre.split(",").map((g) => `"${g.trim()}"`).join(", ")
      : "";
    const image = info?.poster || result.poster || "";
    const totalSeasons = info?.totalSeasons ?? 0;
    const imdbId = info?.imdbId ?? "";

    // Fetch every season. If the series-level lookup (for the season count)
    // failed or returned 0, don't silently assume "1 season" — probe
    // sequentially instead, stopping once TMDb stops returning episodes.
    const seasonEntries: { number: number; data: Awaited<ReturnType<typeof tmdb.getSeason>> }[] = [];
    if (totalSeasons > 0) {
      const capped = Math.min(totalSeasons, MAX_SEASONS_ON_ADD);
      const fetched = await Promise.all(
        Array.from({ length: capped }, (_, i) => i + 1).map((n) => tmdb.getSeason(result.tmdbId, n)),
      );
      fetched.forEach((data, i) => seasonEntries.push({ number: i + 1, data }));
    } else {
      for (let n = 1; n <= MAX_SEASONS_ON_ADD; n++) {
        const data = await tmdb.getSeason(result.tmdbId, n);
        if (!data || data.episodes.length === 0) break;
        seasonEntries.push({ number: n, data });
      }
    }
    if (seasonEntries.length === 0) {
      seasonEntries.push({ number: 1, data: null });
    }

    const seasonBlocks = seasonEntries
      .map(({ number, data }) => {
        if (!data || data.episodes.length === 0) {
          return `## Season ${number}\n- [ ] E1\n`;
        }
        const lines = data.episodes.map((ep) => `- [ ] E${ep.episode} — ${ep.title}`).join("\n");
        return `## Season ${number}\n${lines}\n`;
      })
      .join("\n");

    const fileName = sanitizeFileName(`${result.title} (${result.year})`);
    const path = normalizePath(`${folder}/${fileName}.md`);
    const sourceUrl = imdbId ? `https://www.imdb.com/title/${imdbId}/` : "";

    const content = `---
type: series
title: "${escapeYamlString(result.title)}"
status: want-to-watch
rating: null
total_seasons: ${totalSeasons || "null"}
source: manual
source_url: "${sourceUrl}"
tags: [${genres}]
date_added: ${todayIso()}
date_completed: ""
image: "${image}"
---

# ${result.title}

${seasonBlocks}
## Notes
`;

    await this.app.vault.create(path, content);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function escapeYamlString(s: string): string {
  return s.replace(/"/g, '\\"');
}
