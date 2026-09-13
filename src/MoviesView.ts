import { ItemView, WorkspaceLeaf, TFile, Notice, requestUrl } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import {
  MovieFrontmatter,
  parseMovieFrontmatter,
  splitFrontmatter,
  setFrontmatterNumberField,
  setFrontmatterStringField,
  getNotesSection,
  setNotesSection,
  extractImdbId,
  normalizeFolderPath,
  MOVIE_STATUS_OPTIONS,
  movieStatusLabel,
} from "./MovieParser";
import { AddMovieModal } from "./AddMovieModal";
import { OmdbClient, OmdbFetcher } from "./OmdbClient";
import { todayIso } from "./dateUtil";
import { ConfirmModal } from "./ConfirmModal";
import { pruneOmdbCache } from "./cachePrune";

export const VIEW_TYPE_MOVIES = "series-tracker-movies";

/** Routes OMDb requests through Obsidian's CORS-safe requestUrl API. */
const obsidianOmdbFetcher: OmdbFetcher = async (url) => {
  const res = await requestUrl({ url });
  return { json: res.json };
};

interface ParsedMovie {
  frontmatter: MovieFrontmatter;
  filePath: string;
}

export class MoviesView extends ItemView {
  plugin: SeriesTrackerPlugin;
  private currentFile: TFile | null = null;
  private renderGeneration = 0;
  private filterText = "";
  private filterStatus: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SeriesTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_MOVIES;
  }

  getDisplayText() {
    return "Movie Tracker";
  }

  getIcon() {
    return "clapperboard";
  }

  async onOpen() {
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && this.isRelevantFile(file)) {
          void this.render();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && this.isRelevantFile(file)) {
          void this.render();
        }
      }),
    );
    await this.render();
  }

  private isRelevantFile(file: TFile): boolean {
    if (this.currentFile) return file.path === this.currentFile.path;
    const folder = normalizeFolderPath(this.plugin.settings.moviesFolder);
    return file.path.startsWith(folder + "/");
  }

  async loadAllMovies(): Promise<{ file: TFile; parsed: ParsedMovie }[]> {
    const folder = normalizeFolderPath(this.plugin.settings.moviesFolder);
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") && !f.path.includes("/_bases/"));

    const results: { file: TFile; parsed: ParsedMovie }[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      if (!fm || fm.type !== "movie") continue;
      results.push({
        file,
        parsed: {
          frontmatter: parseMovieFrontmatter(fm),
          filePath: file.path,
        },
      });
    }
    return results;
  }

  async render() {
    const generation = ++this.renderGeneration;
    try {
      if (this.currentFile) {
        await this.renderDetail(this.currentFile, generation);
      } else {
        await this.renderDashboard(generation);
      }
    } catch (err) {
      console.error("Series Tracker: failed to render movies view", err);
      new Notice(`Series Tracker failed to render: ${errorMessage(err)}`);
    }
  }

  async renderDashboard(generation: number) {
    const all = await this.loadAllMovies();
    if (generation !== this.renderGeneration) return;

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const folder = normalizeFolderPath(this.plugin.settings.moviesFolder);
    const folderExists = await this.app.vault.adapter.exists(folder);
    if (generation !== this.renderGeneration) return;
    if (!folderExists) {
      container.createEl("p", {
        cls: "st-folder-missing",
        text: `Configured movies folder "${folder}" doesn't exist. Check Settings → Series Tracker.`,
      });
      return;
    }

    // Fire-and-forget: drop OMDb cache entries for shows/movies no longer
    // tracked. Never awaited — must not delay or race the render below.
    void this.pruneCache();

    const header = container.createDiv({ cls: "st-dashboard-header" });

    const filterInput = header.createEl("input", {
      type: "text",
      cls: "st-filter-input",
      placeholder: "Filter movies…",
    });
    filterInput.value = this.filterText;
    filterInput.addEventListener("input", () => {
      this.filterText = filterInput.value;
      void this.render();
    });

    const statusWrap = header.createDiv({ cls: "st-status-filter-wrap" });
    const statusBtn = statusWrap.createEl("button", {
      cls: "st-status-filter-btn",
      text: this.filterStatus ? `Status: ${movieStatusLabel(this.filterStatus)} ✕` : "+ Status",
    });
    const statusMenu = statusWrap.createDiv({ cls: "st-status-menu" });
    let statusMenuOpen = false;
    statusMenu.hide();

    const counts: Record<string, number> = {};
    for (const { parsed } of all) {
      const s = parsed.frontmatter.status;
      counts[s] = (counts[s] ?? 0) + 1;
    }

    for (const opt of MOVIE_STATUS_OPTIONS) {
      const row = statusMenu.createDiv({ cls: "st-status-menu-row" });
      row.createSpan({ text: opt.label });
      row.createSpan({ cls: "st-status-menu-count", text: String(counts[opt.value] ?? 0) });
      row.addEventListener("click", () => {
        this.filterStatus = this.filterStatus === opt.value ? null : opt.value;
        void this.render();
      });
    }
    statusBtn.addEventListener("click", () => {
      statusMenuOpen = !statusMenuOpen;
      statusMenu.toggle(statusMenuOpen);
    });

    const addBtn = header.createEl("button", { cls: "st-add-series", text: "+ Add movie" });
    addBtn.addEventListener("click", () => {
      new AddMovieModal(this.app, this.plugin, () => void this.render()).open();
    });

    const filtered = all.filter(({ parsed }) => {
      if (this.filterStatus && parsed.frontmatter.status !== this.filterStatus) return false;
      if (this.filterText.trim() && !parsed.frontmatter.title.toLowerCase().includes(this.filterText.trim().toLowerCase())) {
        return false;
      }
      return true;
    });

    const watchedCount = filtered.filter((m) => m.parsed.frontmatter.status === "watched").length;
    const favouriteCount = filtered.filter((m) => m.parsed.frontmatter.favourite).length;

    const stats = container.createDiv({ cls: "st-stats" });
    const tile1 = stats.createDiv({ cls: "st-tile" });
    tile1.createDiv({ cls: "st-tile-value", text: `${watchedCount}/${filtered.length}` });
    tile1.createDiv({ cls: "st-tile-label", text: "Movies watched" });

    const tile2 = stats.createDiv({ cls: "st-tile" });
    tile2.createDiv({ cls: "st-tile-value", text: `${favouriteCount}` });
    tile2.createDiv({ cls: "st-tile-label", text: "Favourites" });

    const tile3 = stats.createDiv({ cls: "st-tile" });
    tile3.createDiv({ cls: "st-tile-value", text: `${filtered.length}` });
    tile3.createDiv({ cls: "st-tile-label", text: this.filterStatus || this.filterText ? "Movies matching" : "Movies tracked" });

    const grid = container.createDiv({ cls: "st-grid" });
    for (const { file, parsed } of filtered) {
      const card = grid.createDiv({ cls: "st-card" });
      if (parsed.frontmatter.image) {
        card.createEl("img", { attr: { src: parsed.frontmatter.image } });
      }
      card.createDiv({ cls: "st-card-title", text: parsed.frontmatter.title + (parsed.frontmatter.favourite ? " ★" : "") });
      card.createDiv({ cls: "st-card-status", text: movieStatusLabel(parsed.frontmatter.status) });
      card.onClickEvent(() => {
        this.currentFile = file;
        void this.render();
      });
    }

    if (all.length === 0) {
      grid.createEl("p", { cls: "st-empty-state", text: "No movies tracked yet — click + Add movie to get started." });
    } else if (filtered.length === 0) {
      grid.createEl("p", { cls: "st-empty-state", text: "No movies match the current filter." });
    }
  }

  /**
   * Drops OMDb cache entries for shows/movies no longer tracked in the
   * vault. Fire-and-forget: only saves settings when something changed.
   */
  private async pruneCache(): Promise<void> {
    try {
      const liveImdbIds = this.plugin.getAllLiveImdbIds();
      const { pruned, removedCount } = pruneOmdbCache(this.plugin.settings.omdbCache, liveImdbIds);
      if (removedCount === 0) return;
      this.plugin.settings.omdbCache = pruned;
      await this.plugin.saveSettings();
    } catch (err) {
      console.error("Series Tracker: failed to prune OMDb cache", err);
    }
  }

  async renderDetail(file: TFile, generation: number) {
    if (generation !== this.renderGeneration) return;

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const back = container.createEl("button", { text: "← Back to dashboard" });
    back.onClickEvent(() => {
      this.currentFile = null;
      void this.render();
    });

    await this.renderMovieDetail(
      container,
      file,
      () => void this.render(),
      () => generation === this.renderGeneration,
      () => {
        this.currentFile = null;
        void this.render();
      },
    );
  }

  private async renderMovieDetail(
    container: Element,
    file: TFile,
    onChange: () => void,
    isCurrent: () => boolean,
    onDeleted: () => void,
  ): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      if (!isCurrent()) return;

      const { body } = splitFrontmatter(content);
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = parseMovieFrontmatter((cache?.frontmatter as Record<string, unknown> | undefined) ?? {});

      container.createEl("h2", { text: fm.title });

      if (fm.image) {
        container.createEl("img", { cls: "st-detail-poster", attr: { src: fm.image } });
      }

      if (fm.date_added) {
        container.createDiv({ cls: "st-date-added", text: `Added: ${fm.date_added}` });
      }

      // Status — 3-value picker. Stamps date_completed with today on
      // transition into "watched"; clears it on transition out.
      const statusRow = container.createDiv({ cls: "st-status-row" });
      statusRow.createSpan({ text: "Status: " });
      const statusSelect = statusRow.createEl("select", { cls: "st-status-select" });
      for (const opt of MOVIE_STATUS_OPTIONS) {
        statusSelect.createEl("option", { value: opt.value, text: opt.label });
      }
      statusSelect.value = fm.status;
      const handleStatusChange = async () => {
        const next = statusSelect.value;
        const previous = fm.status;
        try {
          await this.app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            let fmBlock = setFrontmatterStringField(live.frontmatterBlock, "status", next);
            if (next === "watched" && previous !== "watched") {
              fmBlock = setFrontmatterStringField(fmBlock, "date_completed", `"${todayIso()}"`);
            } else if (next !== "watched" && previous === "watched") {
              fmBlock = setFrontmatterStringField(fmBlock, "date_completed", `""`);
            }
            return fmBlock + live.body;
          });
          fm.status = next;
        } catch (err) {
          statusSelect.value = previous;
          console.error("Series Tracker: failed to write status", err);
          new Notice(`Series Tracker: failed to save status — ${errorMessage(err)}`);
        }
      };
      statusSelect.addEventListener("change", () => void handleStatusChange());

      // Personal rating — dropdown 0-5 (plus "Unrated").
      const ratingRow = container.createDiv({ cls: "st-rating-row" });
      ratingRow.createSpan({ text: "Your rating: " });
      const ratingSelect = ratingRow.createEl("select", { cls: "st-rating-select" });
      ratingSelect.createEl("option", { value: "", text: "Unrated" });
      for (let i = 0; i <= 5; i++) {
        ratingSelect.createEl("option", { value: String(i), text: String(i) });
      }
      ratingSelect.value = fm.rating !== null ? String(fm.rating) : "";
      const handleRatingChange = async () => {
        const next = ratingSelect.value === "" ? null : parseInt(ratingSelect.value, 10);
        const previous = fm.rating;
        try {
          await this.app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            return setFrontmatterNumberField(live.frontmatterBlock, "rating", next) + live.body;
          });
          fm.rating = next;
        } catch (err) {
          ratingSelect.value = previous !== null ? String(previous) : "";
          console.error("Series Tracker: failed to write rating", err);
          new Notice(`Series Tracker: failed to save rating — ${errorMessage(err)}`);
        }
      };
      ratingSelect.addEventListener("change", () => void handleRatingChange());

      // Favourite toggle.
      const favRow = container.createDiv({ cls: "st-rating-row" });
      const favCheckbox = favRow.createEl("input", { type: "checkbox" });
      favCheckbox.checked = fm.favourite;
      favRow.createSpan({ text: " Favourite" });
      const handleFavouriteChange = async () => {
        const next = favCheckbox.checked;
        try {
          await this.app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            return setFrontmatterStringField(live.frontmatterBlock, "favourite", String(next)) + live.body;
          });
          fm.favourite = next;
        } catch (err) {
          favCheckbox.checked = !next;
          console.error("Series Tracker: failed to write favourite", err);
          new Notice(`Series Tracker: failed to save favourite — ${errorMessage(err)}`);
        }
      };
      favCheckbox.addEventListener("change", () => void handleFavouriteChange());

      const imdbId = extractImdbId(fm.source_url);

      if (imdbId) {
        const omdb = new OmdbClient(
          this.plugin.settings.omdbApiKey,
          this.plugin.settings.omdbCache,
          async (c) => {
            this.plugin.settings.omdbCache = c;
            await this.plugin.saveSettings();
          },
          obsidianOmdbFetcher,
        );
        const info = await omdb.getSeries(imdbId);
        if (!isCurrent()) return;
        if (info) {
          const panel = container.createDiv({ cls: "st-info-panel" });
          if (info.plot) panel.createEl("p", { cls: "st-info-plot", text: info.plot });
          const meta = panel.createDiv({ cls: "st-info-meta" });
          const fields: [string, string][] = [
            ["Rated", info.rated],
            ["Runtime", info.runtime],
            ["Genre", info.genre],
            ["IMDb rating", info.imdbRating],
            ["Awards", info.awards],
          ];
          for (const [label, value] of fields) {
            if (!value || value === "N/A") continue;
            const row = meta.createDiv({ cls: "st-info-row" });
            row.createEl("strong", { text: `${label}: ` });
            row.createSpan({ text: value });
          }
        }
      }

      // Freeform notes, stored under a `## Notes` heading in the body.
      const notesSection = container.createDiv({ cls: "st-notes-section" });
      notesSection.createEl("h3", { text: "Notes" });
      const notesArea = notesSection.createEl("textarea", { cls: "st-notes-textarea" });
      notesArea.value = getNotesSection(body);
      let notesSaveTimer: number | undefined;
      const saveNotes = async () => {
        try {
          await this.app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            return live.frontmatterBlock + setNotesSection(live.body, notesArea.value);
          });
        } catch (err) {
          console.error("Series Tracker: failed to save notes", err);
          new Notice(`Series Tracker: failed to save notes — ${errorMessage(err)}`);
        }
      };
      notesArea.addEventListener("input", () => {
        window.clearTimeout(notesSaveTimer);
        notesSaveTimer = window.setTimeout(() => void saveNotes(), 600);
      });

      // Delete — the only way to remove a tracked movie from the UI
      // (previously required deleting the note file directly in Obsidian).
      // Moves the note to Obsidian's trash, never a hard filesystem delete,
      // and only ever runs on an explicit confirmed click.
      const deleteSection = container.createDiv({ cls: "st-delete-section" });
      const deleteBtn = deleteSection.createEl("button", { cls: "st-delete-btn", text: "Delete movie" });
      deleteBtn.addEventListener("click", () => {
        new ConfirmModal(
          this.app,
          "Delete movie?",
          `This moves "${fm.title}" to Obsidian's trash. You can restore it from there if this was a mistake.`,
          "Delete",
          async () => {
            try {
              await this.app.fileManager.trashFile(file);
              new Notice(`Deleted "${fm.title}"`);
              onDeleted();
            } catch (err) {
              console.error("Series Tracker: failed to delete movie", err);
              new Notice(`Series Tracker: failed to delete movie — ${errorMessage(err)}`);
            }
          },
        ).open();
      });
    } catch (err) {
      console.error("Series Tracker: failed to render movie detail", err);
      if (isCurrent()) {
        new Notice(`Series Tracker: failed to load movie — ${errorMessage(err)}`);
      }
    }
  }

  async onClose() {}
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
