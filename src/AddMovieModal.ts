import { App, Modal, Notice, normalizePath, requestUrl } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { OmdbClient, OmdbFetcher, OmdbSearchResult } from "./OmdbClient";
import { todayIso } from "./dateUtil";
import { parseImdbId } from "./MovieParser";

const obsidianOmdbFetcher: OmdbFetcher = async (url) => {
  const res = await requestUrl({ url });
  return { json: res.json };
};

/** Modal: search OMDb by title, pick a result, create a movie note for it. */
export class AddMovieModal extends Modal {
  private plugin: SeriesTrackerPlugin;
  private onAdded: () => void;
  private resultsEl!: HTMLElement;

  constructor(app: App, plugin: SeriesTrackerPlugin, onAdded: () => void) {
    super(app);
    this.plugin = plugin;
    this.onAdded = onAdded;
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

    const runSearch = async () => {
      const title = input.value.trim();
      if (!title) return;
      this.resultsEl.empty();
      this.resultsEl.createEl("p", { text: "Searching…" });

      const omdb = new OmdbClient(
        this.plugin.settings.omdbApiKey,
        this.plugin.settings.omdbCache,
        async (c) => {
          this.plugin.settings.omdbCache = c;
          await this.plugin.saveSettings();
        },
        obsidianOmdbFetcher,
      );

      const results = await omdb.searchTitles(title, "movie");
      this.renderResults(results, omdb);
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
      const omdb = new OmdbClient(
        this.plugin.settings.omdbApiKey,
        this.plugin.settings.omdbCache,
        async (c) => {
          this.plugin.settings.omdbCache = c;
          await this.plugin.saveSettings();
        },
        obsidianOmdbFetcher,
      );
      try {
        const info = await omdb.getSeries(imdbId);
        if (!info || !info.title) {
          throw new Error(`no movie found for ${imdbId}`);
        }
        if (info.type && info.type !== "movie") {
          throw new Error(`${imdbId} is a ${info.type}, not a movie`);
        }
        const result: OmdbSearchResult = {
          title: info.title,
          year: info.year,
          imdbId,
          poster: info.poster,
        };
        await this.createMovieNote(result, omdb);
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

  private renderResults(results: OmdbSearchResult[], omdb: OmdbClient): void {
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
      const info = row.createDiv();
      info.createEl("div", { text: `${r.title} (${r.year})`, cls: "st-modal-result-title" });
      const addBtn = row.createEl("button", { text: "Add" });
      const handleAdd = async () => {
        addBtn.disabled = true;
        addBtn.textContent = "Adding…";
        try {
          await this.createMovieNote(r, omdb);
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

  private async createMovieNote(result: OmdbSearchResult, omdb: OmdbClient): Promise<void> {
    const folder = this.plugin.settings.moviesFolder;
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }

    const info = await omdb.getSeries(result.imdbId);
    const genres = info?.genre
      ? info.genre.split(",").map((g) => `"${g.trim()}"`).join(", ")
      : "";
    const image = info?.poster || result.poster || "";

    const fileName = sanitizeFileName(`${result.title} ${result.year}`);
    const path = normalizePath(`${folder}/${fileName}.md`);

    const content = `---
type: movie
title: "${escapeYamlString(result.title)}"
status: want-to-watch
source: manual
source_url: "https://www.imdb.com/title/${result.imdbId}/"
genre: [${genres}]
language: ""
favourite: false
rating: null
tags: [${genres}]
date_added: ${todayIso()}
date_completed: ""
image: "${image}"
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

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function escapeYamlString(s: string): string {
  return s.replace(/"/g, '\\"');
}
