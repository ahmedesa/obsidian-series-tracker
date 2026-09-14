import { App, Modal, Notice, normalizePath } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { createMetadataProvider, MetadataProvider, MetadataSearchResult } from "./MetadataProvider";
import { todayIso } from "./dateUtil";
import { parseImdbId } from "./MovieParser";

/** Modal: search TMDb by title, pick a result, create a movie note for it. */
export class AddMovieModal extends Modal {
  private plugin: SeriesTrackerPlugin;
  private onAdded: () => void;
  private resultsEl!: HTMLElement;
  private preloadedResult?: MetadataSearchResult;

  /**
   * `preloadedResult` skips straight to a single pre-filled result (still
   * requiring the user's own "Add" click to confirm) — used by the
   * recommendations panel so suggesting a title doesn't need to duplicate
   * `createMovieNote`/re-implement search.
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
    contentEl.createEl("h2", { text: "Add movie" });

    const searchRow = contentEl.createDiv({ cls: "st-modal-search-row" });
    const input = searchRow.createEl("input", {
      type: "text",
      placeholder: "Movie title…",
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
      const results = await tmdb.search(title, "movie");
      this.renderResults(results, tmdb);
    };

    searchBtn.addEventListener("click", () => void runSearch());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void runSearch();
    });
    input.focus();

    contentEl.createEl("p", {
      text: "Can't find it by title, such as a non-English title? Add it directly by IMDb ID or URL:",
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
        new Notice("Series tracker: enter a valid IMDb ID or URL, like tt1234567.");
        return;
      }
      idBtn.disabled = true;
      idBtn.textContent = "Adding…";
      const tmdb = this.newClient();
      try {
        const info = await tmdb.getDetailsByExternalId(imdbId);
        if (!info || !info.title) {
          throw new Error(`no movie found for ${imdbId}`);
        }
        if (info.type && info.type !== "movie") {
          throw new Error(`${imdbId} is a ${info.type}, not a movie`);
        }
        const result: MetadataSearchResult = {
          title: info.title,
          year: info.year,
          tmdbId: info.tmdbId,
          poster: info.poster,
          rating: info.imdbRating,
          plot: info.plot,
        };
        await this.createMovieNote(result, tmdb);
        new Notice(`Added "${result.title}"`);
        this.onAdded();
        this.close();
      } catch (err) {
        idBtn.disabled = false;
        idBtn.textContent = "Add by ID";
        console.error("Series Tracker: failed to add movie by ID", err);
        new Notice(`Series Tracker: failed to add movie — ${err instanceof Error ? err.message : String(err)}`);
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
      titleRow.createSpan({ text: `${r.title} (${r.year})`, cls: "st-modal-result-title" });
      if (r.rating) {
        titleRow.createSpan({ text: `★ ${r.rating}`, cls: "st-modal-result-rating" });
      }
      if (r.plot) {
        info.createDiv({ text: truncate(r.plot, 140), cls: "st-modal-result-plot" });
      }
      const addBtn = row.createEl("button", { text: "Add" });
      const handleAdd = async () => {
        addBtn.disabled = true;
        addBtn.textContent = "Adding…";
        try {
          await this.createMovieNote(r, tmdb);
          new Notice(`Added "${r.title}"`);
          this.onAdded();
          this.close();
        } catch (err) {
          addBtn.disabled = false;
          addBtn.textContent = "Add";
          console.error("Series Tracker: failed to add movie", err);
          new Notice(`Series Tracker: failed to add movie — ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      addBtn.addEventListener("click", () => void handleAdd());
    }
  }

  private async createMovieNote(result: MetadataSearchResult, tmdb: MetadataProvider): Promise<void> {
    const folder = this.plugin.settings.moviesFolder;
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }

    const info = await tmdb.getDetails(result.tmdbId, "movie");
    const genres = info?.genre
      ? info.genre.split(",").map((g) => `"${g.trim()}"`).join(", ")
      : "";
    const image = info?.poster || result.poster || "";
    const imdbId = info?.imdbId ?? "";
    const contentRating = info?.rated ?? "";
    const backdrop = info?.backdrop ?? "";

    const fileName = sanitizeFileName(`${result.title} ${result.year}`);
    const path = normalizePath(`${folder}/${fileName}.md`);
    const sourceUrl = imdbId ? `https://www.imdb.com/title/${imdbId}/` : "";

    const content = `---
type: movie
title: "${escapeYamlString(result.title)}"
status: want-to-watch
source: manual
source_url: "${sourceUrl}"
genre: [${genres}]
language: ""
favourite: false
rating: null
tags: [${genres}]
date_added: ${todayIso()}
date_completed: ""
image: "${image}"
content_rating: "${escapeYamlString(contentRating)}"
backdrop: "${backdrop}"
---

# ${result.title}

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
